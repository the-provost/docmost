import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreatePageDto } from '../dto/create-page.dto';
import { UpdatePageDto } from '../dto/update-page.dto';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { Page } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  executeWithPagination,
  PaginationResult,
} from '@docmost/db/pagination/pagination';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { MovePageDto } from '../dto/move-page.dto';
import { ExpressionBuilder } from 'kysely';
import { DB } from '@docmost/db/types/db';
import { SidebarPageDto } from '../dto/sidebar-page.dto';

@Injectable()
export class PageService {
  constructor(
    private pageRepo: PageRepo,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async findById(
    pageId: string,
    includeContent?: boolean,
    includeYdoc?: boolean,
  ): Promise<Page> {
    return this.pageRepo.findById(pageId, { includeContent, includeYdoc });
  }

  async create(
    userId: string,
    workspaceId: string,
    createPageDto: CreatePageDto,
  ): Promise<Page> {
    // check if parent page exists
    if (createPageDto.parentPageId) {
      // TODO: make sure parent page belongs to same space and user has permissions
      // make sure user has permission to parent.
      const parentPage = await this.pageRepo.findById(
        createPageDto.parentPageId,
      );
      if (!parentPage) throw new NotFoundException('Parent page not found');
    }

    let pagePosition: string;

    const lastPageQuery = this.db
      .selectFrom('pages')
      .select(['id', 'position'])
      .where('spaceId', '=', createPageDto.spaceId)
      .orderBy('position', 'desc')
      .limit(1);

    // todo: simplify code
    if (createPageDto.parentPageId) {
      // check for children of this page
      const lastPage = await lastPageQuery
        .where('parentPageId', '=', createPageDto.parentPageId)
        .executeTakeFirst();

      if (!lastPage) {
        pagePosition = generateJitteredKeyBetween(null, null);
      } else {
        // if there is an existing page, we should get a position below it
        pagePosition = generateJitteredKeyBetween(lastPage.position, null);
      }
    } else {
      // for root page
      const lastPage = await lastPageQuery
        .where('parentPageId', 'is', null)
        .executeTakeFirst();

      // if no existing page, make this the first
      if (!lastPage) {
        pagePosition = generateJitteredKeyBetween(null, null); // we expect "a0"
      } else {
        // if there is an existing page, we should get a position below it
        pagePosition = generateJitteredKeyBetween(lastPage.position, null);
      }
    }

    const createdPage = await this.pageRepo.insertPage({
      title: createPageDto.title,
      position: pagePosition,
      icon: createPageDto.icon,
      parentPageId: createPageDto.parentPageId,
      spaceId: createPageDto.spaceId,
      creatorId: userId,
      workspaceId: workspaceId,
      lastUpdatedById: userId,
    });

    return createdPage;
  }

  async update(
    pageId: string,
    updatePageDto: UpdatePageDto,
    userId: string,
  ): Promise<Page> {
    await this.pageRepo.updatePage(
      {
        title: updatePageDto.title,
        icon: updatePageDto.icon,
        lastUpdatedById: userId,
      },
      pageId,
    );

    return await this.pageRepo.findById(pageId);
  }

  async updateState(
    pageId: string,
    content: any,
    textContent: string,
    ydoc: any,
    userId?: string, // TODO: fix this
  ): Promise<void> {
    await this.pageRepo.updatePage(
      {
        content: content,
        textContent: textContent,
        ydoc: ydoc,
        ...(userId && { lastUpdatedById: userId }),
      },
      pageId,
    );
  }

  withHasChildren(eb: ExpressionBuilder<DB, 'pages'>) {
    return eb
      .selectFrom('pages as child')
      .select((eb) =>
        eb
          .case()
          .when(eb.fn.countAll(), '>', 0)
          .then(true)
          .else(false)
          .end()
          .as('count'),
      )
      .whereRef('child.parentPageId', '=', 'pages.id')
      .limit(1)
      .as('hasChildren');
  }

  async getSidebarPages(
    dto: SidebarPageDto,
    pagination: PaginationOptions,
  ): Promise<any> {
    let query = this.db
      .selectFrom('pages')
      .select([
        'id',
        'title',
        'icon',
        'position',
        'parentPageId',
        'spaceId',
        'creatorId',
      ])
      .select((eb) => this.withHasChildren(eb))
      .orderBy('position', 'asc')
      .where('spaceId', '=', dto.spaceId);

    if (dto.pageId) {
      query = query.where('parentPageId', '=', dto.pageId);
    } else {
      query = query.where('parentPageId', 'is', null);
    }

    const result = executeWithPagination(query, {
      page: pagination.page,
      perPage: 250,
    });

    return result;
  }

  async movePage(dto: MovePageDto) {
    // validate position value by attempting to generate a key
    try {
      generateJitteredKeyBetween(dto.position, null);
    } catch (err) {
      throw new BadRequestException('Invalid move position');
    }

    const movedPage = await this.pageRepo.findById(dto.pageId);
    if (!movedPage) throw new NotFoundException('Moved page not found');

    let parentPageId: string;
    if (movedPage.parentPageId === dto.parentPageId) {
      parentPageId = undefined;
    } else {
      // changing the page's parent
      if (dto.parentPageId) {
        const parentPage = await this.pageRepo.findById(dto.parentPageId);
        if (!parentPage) throw new NotFoundException('Parent page not found');
      }
      parentPageId = dto.parentPageId;
    }

    await this.pageRepo.updatePage(
      {
        position: dto.position,
        parentPageId: parentPageId,
      },
      dto.pageId,
    );

    // TODO
    // check for duplicates?
    // permissions
  }

  async getRecentSpacePages(
    spaceId: string,
    pagination: PaginationOptions,
  ): Promise<PaginationResult<Page>> {
    const pages = await this.pageRepo.getRecentPagesInSpace(
      spaceId,
      pagination,
    );

    return pages;
  }

  async forceDelete(pageId: string): Promise<void> {
    await this.pageRepo.deletePage(pageId);
  }
}
/*
  // TODO: page deletion and restoration
  async delete(pageId: string): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const page = await manager
        .createQueryBuilder(Page, 'page')
        .where('page.id = :pageId', { pageId })
        .select(['page.id', 'page.workspaceId'])
        .getOne();

      if (!page) {
        throw new NotFoundException(`Page not found`);
      }
      await this.softDeleteChildrenRecursive(page.id, manager);
      await this.pageOrderingService.removePageFromHierarchy(page, manager);

      await manager.softDelete(Page, pageId);
    });
  }

  private async softDeleteChildrenRecursive(
    parentId: string,
    manager: EntityManager,
  ): Promise<void> {
    const childrenPage = await manager
      .createQueryBuilder(Page, 'page')
      .where('page.parentPageId = :parentId', { parentId })
      .select(['page.id', 'page.title', 'page.parentPageId'])
      .getMany();

    for (const child of childrenPage) {
      await this.softDeleteChildrenRecursive(child.id, manager);
      await manager.softDelete(Page, child.id);
    }
  }

  async restore(pageId: string): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const isDeleted = await manager
        .createQueryBuilder(Page, 'page')
        .where('page.id = :pageId', { pageId })
        .withDeleted()
        .getCount();

      if (!isDeleted) {
        return;
      }

      await manager.recover(Page, { id: pageId });

      await this.restoreChildrenRecursive(pageId, manager);

      // Fetch the page details to find out its parent and workspace
      const restoredPage = await manager
        .createQueryBuilder(Page, 'page')
        .where('page.id = :pageId', { pageId })
        .select(['page.id', 'page.title', 'page.spaceId', 'page.parentPageId'])
        .getOne();

      if (!restoredPage) {
        throw new NotFoundException(`Restored page not found.`);
      }

      // add page back to its hierarchy
      await this.pageOrderingService.addPageToOrder(
        restoredPage.spaceId,
        pageId,
        restoredPage.parentPageId,
      );
    });
  }

  private async restoreChildrenRecursive(
    parentId: string,
    manager: EntityManager,
  ): Promise<void> {
    const childrenPage = await manager
      .createQueryBuilder(Page, 'page')
      .setLock('pessimistic_write')
      .where('page.parentPageId = :parentId', { parentId })
      .select(['page.id', 'page.title', 'page.parentPageId'])
      .withDeleted()
      .getMany();

    for (const child of childrenPage) {
      await this.restoreChildrenRecursive(child.id, manager);
      await manager.recover(Page, { id: child.id });
    }
  }
*/
