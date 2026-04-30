import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import type {
  AppSession,
  Company,
  CompanyCreateInput,
  CompanyKeyword,
  CompanyKeywordInput,
  CompanyMergeCompanySummary,
  CompanyMergeInput,
  CompanyMergePreview,
  CompanyMergeResult,
  CompanyRelation,
  CompanyRelationInput,
  TradePlan
} from "@iuf-trading-room/contracts";
import {
  companies,
  companyKeywords,
  companyRelations,
  companyThemeLinks,
  getDb,
  tradePlans
} from "@iuf-trading-room/db";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

const beneficiaryTierPriority: Record<Company["beneficiaryTier"], number> = {
  Core: 4,
  Direct: 3,
  Indirect: 2,
  Observation: 1
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeName(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "");
}

function normalizeKeyword(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function duplicateGroupKey(company: Pick<Company, "ticker" | "name">) {
  return `${company.ticker}::${normalizeName(company.name)}`;
}

function relationKey(relation: Pick<CompanyRelationInput, "targetLabel" | "relationType">) {
  return `${normalizeName(relation.targetLabel)}::${relation.relationType}`;
}

function keywordKey(keyword: Pick<CompanyKeywordInput, "label">) {
  return normalizeKeyword(keyword.label);
}

function relationInputFromRelation(relation: CompanyRelation): CompanyRelationInput {
  return {
    targetCompanyId: relation.targetCompanyId ?? undefined,
    targetLabel: relation.targetLabel,
    relationType: relation.relationType,
    confidence: relation.confidence,
    sourcePath: relation.sourcePath
  };
}

function pickPreferredRelation(left: CompanyRelationInput, right: CompanyRelationInput) {
  if (right.confidence !== left.confidence) {
    return right.confidence > left.confidence ? right : left;
  }

  if (Boolean(right.targetCompanyId) !== Boolean(left.targetCompanyId)) {
    return right.targetCompanyId ? right : left;
  }

  return right.sourcePath.localeCompare(left.sourcePath) < 0 ? right : left;
}

function dedupeRelationInputs(relations: CompanyRelationInput[]) {
  const deduped = new Map<string, CompanyRelationInput>();

  for (const relation of relations) {
    const key = relationKey(relation);
    const current = deduped.get(key);
    deduped.set(key, current ? pickPreferredRelation(current, relation) : relation);
  }

  return {
    items: [...deduped.values()],
    collapsed: Math.max(0, relations.length - deduped.size)
  };
}

function pickPreferredKeyword(left: CompanyKeywordInput, right: CompanyKeywordInput) {
  if (right.confidence !== left.confidence) {
    return right.confidence > left.confidence ? right : left;
  }

  return right.sourcePath.localeCompare(left.sourcePath) < 0 ? right : left;
}

function dedupeKeywordInputs(keywords: CompanyKeywordInput[]) {
  const deduped = new Map<string, CompanyKeywordInput>();

  for (const keyword of keywords) {
    const key = keywordKey(keyword);
    const current = deduped.get(key);
    deduped.set(key, current ? pickPreferredKeyword(current, keyword) : keyword);
  }

  return {
    items: [...deduped.values()],
    collapsed: Math.max(0, keywords.length - deduped.size)
  };
}

function buildRelationCountMap(relations: CompanyRelation[]) {
  const counts = new Map<string, number>();

  for (const relation of relations) {
    counts.set(relation.companyId, (counts.get(relation.companyId) ?? 0) + 1);
  }

  return counts;
}

function buildKeywordCountMap(keywords: CompanyKeyword[]) {
  const counts = new Map<string, number>();

  for (const keyword of keywords) {
    counts.set(keyword.companyId, (counts.get(keyword.companyId) ?? 0) + 1);
  }

  return counts;
}

function buildTradePlanCountMap(plans: TradePlan[]) {
  const counts = new Map<string, number>();

  for (const plan of plans) {
    counts.set(plan.companyId, (counts.get(plan.companyId) ?? 0) + 1);
  }

  return counts;
}

function buildCompanyMergeSummary(input: {
  company: Company;
  relationCounts: Map<string, number>;
  keywordCounts: Map<string, number>;
  tradePlanCounts: Map<string, number>;
}): CompanyMergeCompanySummary {
  return {
    companyId: input.company.id,
    ticker: input.company.ticker,
    name: input.company.name,
    market: input.company.market,
    country: input.company.country,
    beneficiaryTier: input.company.beneficiaryTier,
    themeCount: input.company.themeIds.length,
    relationCount: input.relationCounts.get(input.company.id) ?? 0,
    keywordCount: input.keywordCounts.get(input.company.id) ?? 0,
    tradePlanCount: input.tradePlanCounts.get(input.company.id) ?? 0,
    updatedAt: input.company.updatedAt
  };
}

function appendMergedNotes(target: Company, sources: Company[], appendSourceNotes: boolean) {
  if (!appendSourceNotes) {
    return { notes: target.notes, appended: false };
  }

  const targetNotes = target.notes.trim();
  const sourceBlocks = sources
    .map((source) => source.notes.trim() ? `[Merged ${source.ticker} ${source.name}]\n${source.notes.trim()}` : "")
    .filter(Boolean)
    .filter((block) => !targetNotes.includes(block));

  if (sourceBlocks.length === 0) {
    return { notes: target.notes, appended: false };
  }

  const notes = [targetNotes, ...sourceBlocks].filter(Boolean).join("\n\n");
  return { notes, appended: true };
}

function buildMergePlan(input: {
  target: Company;
  sources: Company[];
  companies: Company[];
  relations: CompanyRelation[];
  keywords: CompanyKeyword[];
  tradePlans: TradePlan[];
  force?: boolean;
  appendSourceNotes?: boolean;
}): {
  preview: CompanyMergePreview;
  mergedThemeIds: string[];
  mergedNotes: string;
  rebuiltRelations: Array<{ companyId: string; relations: CompanyRelationInput[] }>;
  mergedKeywords: CompanyKeywordInput[];
  sourceCompanyIds: string[];
} {
  const sourceIds = [...new Set(input.sources.map((company) => company.id))];
  const mergeSet = new Set([input.target.id, ...sourceIds]);
  const sourceSet = new Set(sourceIds);
  const sourceAliasSet = new Set(input.sources.map((company) => normalizeName(company.name)));
  const mergeAliasSet = new Set([normalizeName(input.target.name), ...sourceAliasSet]);
  const relationCounts = buildRelationCountMap(input.relations);
  const keywordCounts = buildKeywordCountMap(input.keywords);
  const tradePlanCounts = buildTradePlanCountMap(input.tradePlans);
  const warnings: string[] = [];

  const mismatchedSources = input.sources.filter(
    (source) => duplicateGroupKey(source) !== duplicateGroupKey(input.target)
  );
  if (mismatchedSources.length > 0) {
    warnings.push("Some source companies are not in the same duplicate group as the target.");
  }

  const { notes: mergedNotes, appended } = appendMergedNotes(
    input.target,
    input.sources,
    input.appendSourceNotes ?? true
  );

  const mergedThemeIds = [...new Set([input.target.themeIds, ...input.sources.map((source) => source.themeIds)].flat())];

  const referencesMergeGroup = (relation: CompanyRelation) =>
    (relation.targetCompanyId && mergeSet.has(relation.targetCompanyId)) ||
    mergeAliasSet.has(normalizeName(relation.targetLabel));

  const referencesSourceGroup = (relation: CompanyRelation) =>
    (relation.targetCompanyId && sourceSet.has(relation.targetCompanyId)) ||
    sourceAliasSet.has(normalizeName(relation.targetLabel));

  const canonicalizeTarget = (relation: CompanyRelationInput) => ({
    ...relation,
    targetCompanyId: input.target.id,
    targetLabel: input.target.name
  });

  const targetCandidateRelations = input.relations
    .filter((relation) => mergeSet.has(relation.companyId))
    .map((relation) => relationInputFromRelation(relation))
    .map((relation) => {
      if (
        (relation.targetCompanyId && mergeSet.has(relation.targetCompanyId)) ||
        mergeAliasSet.has(normalizeName(relation.targetLabel))
      ) {
        return canonicalizeTarget(relation);
      }
      return relation;
    })
    .filter(
      (relation) =>
        !(relation.targetCompanyId === input.target.id && normalizeName(relation.targetLabel) === normalizeName(input.target.name))
    );

  const targetDeduped = dedupeRelationInputs(targetCandidateRelations);

  const externalAffectedCompanyIds = [
    ...new Set(
      input.relations
        .filter((relation) => !mergeSet.has(relation.companyId) && referencesSourceGroup(relation))
        .map((relation) => relation.companyId)
    )
  ];

  const externalRebuilds = externalAffectedCompanyIds.map((companyId) => {
    const current = input.relations
      .filter((relation) => relation.companyId === companyId)
      .map((relation) => relationInputFromRelation(relation))
      .map((relation) => {
        if (
          (relation.targetCompanyId && sourceSet.has(relation.targetCompanyId)) ||
          sourceAliasSet.has(normalizeName(relation.targetLabel))
        ) {
          return canonicalizeTarget(relation);
        }

        return relation;
      });

    const deduped = dedupeRelationInputs(current);

    return {
      companyId,
      relations: deduped.items,
      collapsed: deduped.collapsed
    };
  });

  const mergedKeywordCandidates = input.keywords
    .filter((keyword) => mergeSet.has(keyword.companyId))
    .map((keyword) => ({
      label: keyword.label,
      confidence: keyword.confidence,
      sourcePath: keyword.sourcePath
    } satisfies CompanyKeywordInput));
  const mergedKeywords = dedupeKeywordInputs(mergedKeywordCandidates);
  const sourceTradePlans = input.tradePlans.filter((plan) => sourceSet.has(plan.companyId));

  const preview: CompanyMergePreview = {
    generatedAt: nowIso(),
    allowed: warnings.length === 0 || Boolean(input.force),
    warnings,
    target: buildCompanyMergeSummary({
      company: input.target,
      relationCounts,
      keywordCounts,
      tradePlanCounts
    }),
    sources: input.sources.map((source) =>
      buildCompanyMergeSummary({
        company: source,
        relationCounts,
        keywordCounts,
        tradePlanCounts
      })
    ),
    impact: {
      themeIdsToAttach: Math.max(0, mergedThemeIds.length - input.target.themeIds.length),
      outgoingRelationRowsToRewrite: targetCandidateRelations.length,
      incomingRelationRowsToRewrite: input.relations.filter(
        (relation) => !mergeSet.has(relation.companyId) && referencesSourceGroup(relation)
      ).length,
      keywordRowsToRewrite: mergedKeywordCandidates.length,
      tradePlansToReassign: sourceTradePlans.length,
      duplicateRelationsCollapsed:
        targetDeduped.collapsed + externalRebuilds.reduce((sum, item) => sum + item.collapsed, 0),
      duplicateKeywordsCollapsed: mergedKeywords.collapsed,
      sourceCompaniesToDelete: input.sources.length,
      notesAppended: appended
    }
  };

  return {
    preview,
    mergedThemeIds,
    mergedNotes,
    rebuiltRelations: [
      { companyId: input.target.id, relations: targetDeduped.items },
      ...externalRebuilds.map((item) => ({ companyId: item.companyId, relations: item.relations }))
    ],
    mergedKeywords: mergedKeywords.items,
    sourceCompanyIds: sourceIds
  };
}

async function loadMergeContext(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  merge: CompanyMergeInput;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const [companies, relations, keywords, plans] = await Promise.all([
    input.repo.listCompanies(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyRelations(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyKeywords(undefined, { workspaceSlug }),
    input.repo.listTradePlans(undefined, { workspaceSlug })
  ]);

  const companiesById = new Map(companies.map((company) => [company.id, company]));
  const target = companiesById.get(input.merge.targetCompanyId) ?? null;
  const uniqueSourceIds = [...new Set(input.merge.sourceCompanyIds)].filter(
    (companyId) => companyId !== input.merge.targetCompanyId
  );
  const sources = uniqueSourceIds
    .map((companyId) => companiesById.get(companyId))
    .filter((company): company is Company => Boolean(company));

  return {
    target,
    sources,
    missingSourceIds: uniqueSourceIds.filter((companyId) => !companiesById.has(companyId)),
    companies,
    relations,
    keywords,
    plans
  };
}

export async function getCompanyMergePreview(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  merge: CompanyMergeInput;
}) {
  const context = await loadMergeContext(input);

  if (!context.target) {
    return null;
  }

  const plan = buildMergePlan({
    target: context.target,
    sources: context.sources,
    companies: context.companies,
    relations: context.relations,
    keywords: context.keywords,
    tradePlans: context.plans,
    force: input.merge.force,
    appendSourceNotes: input.merge.appendSourceNotes
  });

  if (context.missingSourceIds.length > 0) {
    plan.preview.allowed = false;
    plan.preview.warnings.push("Some source companies could not be found in this workspace.");
  }

  if (context.sources.length === 0) {
    plan.preview.allowed = false;
    plan.preview.warnings.push("At least one valid source company is required to merge.");
  }

  return plan.preview;
}

function buildDbRelationRows(input: {
  workspaceId: string;
  companyId: string;
  relations: CompanyRelationInput[];
}) {
  return input.relations.map((relation) => ({
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    targetCompanyId: relation.targetCompanyId ?? null,
    targetLabel: relation.targetLabel,
    relationType: relation.relationType,
    confidence: relation.confidence,
    sourcePath: relation.sourcePath,
    createdAt: new Date(),
    updatedAt: new Date()
  }));
}

function buildDbKeywordRows(input: {
  workspaceId: string;
  companyId: string;
  keywords: CompanyKeywordInput[];
}) {
  return input.keywords.map((keyword) => ({
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    label: keyword.label,
    confidence: keyword.confidence,
    sourcePath: keyword.sourcePath,
    createdAt: new Date(),
    updatedAt: new Date()
  }));
}

async function executeCompanyMergeInMemory(input: {
  repo: TradingRoomRepository;
  target: Company;
  sourceCompanyIds: string[];
  mergedThemeIds: string[];
  mergedNotes: string;
  rebuiltRelations: Array<{ companyId: string; relations: CompanyRelationInput[] }>;
  mergedKeywords: CompanyKeywordInput[];
}) {
  const memoryRepo = input.repo as TradingRoomRepository & {
    companies: Company[];
    companyRelations: CompanyRelation[];
    companyKeywords: CompanyKeyword[];
    tradePlans: TradePlan[];
  };

  const sourceSet = new Set(input.sourceCompanyIds);
  const relationRewriteIds = new Set([
    ...input.rebuiltRelations.map((item) => item.companyId),
    ...input.sourceCompanyIds
  ]);

  memoryRepo.companies = memoryRepo.companies
    .map((company) =>
      company.id === input.target.id
        ? {
            ...company,
            themeIds: [...input.mergedThemeIds],
            notes: input.mergedNotes,
            updatedAt: nowIso()
          }
        : company
    )
    .filter((company) => !sourceSet.has(company.id));

  const preservedRelations = memoryRepo.companyRelations.filter(
    (relation) => !relationRewriteIds.has(relation.companyId)
  );
  const rebuiltRelations = input.rebuiltRelations.flatMap((item) =>
    item.relations.map((relation) => ({
      id: randomUUID(),
      companyId: item.companyId,
      targetCompanyId: relation.targetCompanyId ?? null,
      targetLabel: relation.targetLabel,
      relationType: relation.relationType,
      confidence: relation.confidence,
      sourcePath: relation.sourcePath,
      updatedAt: nowIso()
    } satisfies CompanyRelation))
  );
  memoryRepo.companyRelations = [...rebuiltRelations, ...preservedRelations];

  const preservedKeywords = memoryRepo.companyKeywords.filter(
    (keyword) => keyword.companyId !== input.target.id && !sourceSet.has(keyword.companyId)
  );
  const rebuiltKeywords = input.mergedKeywords.map((keyword) => ({
    id: randomUUID(),
    companyId: input.target.id,
    label: keyword.label,
    confidence: keyword.confidence,
    sourcePath: keyword.sourcePath,
    updatedAt: nowIso()
  } satisfies CompanyKeyword));
  memoryRepo.companyKeywords = [...rebuiltKeywords, ...preservedKeywords];

  memoryRepo.tradePlans = memoryRepo.tradePlans.map((plan) =>
    sourceSet.has(plan.companyId)
      ? {
          ...plan,
          companyId: input.target.id,
          updatedAt: nowIso()
        }
      : plan
  );
}

async function executeCompanyMergeInDatabase(input: {
  session: AppSession;
  target: Company;
  sourceCompanyIds: string[];
  mergedThemeIds: string[];
  mergedNotes: string;
  rebuiltRelations: Array<{ companyId: string; relations: CompanyRelationInput[] }>;
  mergedKeywords: CompanyKeywordInput[];
}) {
  const db = getDb();
  if (!db) {
    throw new Error("Database mode is not active.");
  }

  const workspaceId = input.session.workspace.id;
  const mergeSet = [input.target.id, ...input.sourceCompanyIds];
  const relationDeleteCompanyIds = [...new Set([...input.rebuiltRelations.map((item) => item.companyId), ...input.sourceCompanyIds])];

  await db.transaction(async (tx) => {
    await tx
      .update(companies)
      .set({
        notes: input.mergedNotes,
        updatedAt: new Date()
      })
      .where(and(eq(companies.workspaceId, workspaceId), eq(companies.id, input.target.id)));

    await tx.delete(companyThemeLinks).where(inArray(companyThemeLinks.companyId, mergeSet));
    if (input.mergedThemeIds.length > 0) {
      await tx
        .insert(companyThemeLinks)
        .values(
          input.mergedThemeIds.map((themeId) => ({
            companyId: input.target.id,
            themeId
          }))
        )
        .onConflictDoNothing();
    }

    if (relationDeleteCompanyIds.length > 0) {
      await tx
        .delete(companyRelations)
        .where(
          and(
            eq(companyRelations.workspaceId, workspaceId),
            inArray(companyRelations.companyId, relationDeleteCompanyIds)
          )
        );
    }

    const relationRows = input.rebuiltRelations.flatMap((item) =>
      buildDbRelationRows({
        workspaceId,
        companyId: item.companyId,
        relations: item.relations
      })
    );
    if (relationRows.length > 0) {
      await tx.insert(companyRelations).values(relationRows);
    }

    await tx
      .delete(companyKeywords)
      .where(and(eq(companyKeywords.workspaceId, workspaceId), inArray(companyKeywords.companyId, mergeSet)));

    if (input.mergedKeywords.length > 0) {
      await tx.insert(companyKeywords).values(
        buildDbKeywordRows({
          workspaceId,
          companyId: input.target.id,
          keywords: input.mergedKeywords
        })
      );
    }

    if (input.sourceCompanyIds.length > 0) {
      await tx
        .update(tradePlans)
        .set({
          companyId: input.target.id,
          updatedAt: new Date()
        })
        .where(and(eq(tradePlans.workspaceId, workspaceId), inArray(tradePlans.companyId, input.sourceCompanyIds)));

      await tx
        .delete(companies)
        .where(and(eq(companies.workspaceId, workspaceId), inArray(companies.id, input.sourceCompanyIds)));
    }
  });
}

export async function executeCompanyMerge(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  merge: CompanyMergeInput;
}) {
  const context = await loadMergeContext(input);

  if (!context.target) {
    return null;
  }

  const plan = buildMergePlan({
    target: context.target,
    sources: context.sources,
    companies: context.companies,
    relations: context.relations,
    keywords: context.keywords,
    tradePlans: context.plans,
    force: input.merge.force,
    appendSourceNotes: input.merge.appendSourceNotes
  });

  if (context.missingSourceIds.length > 0 || context.sources.length === 0) {
    throw new Error("Company merge could not proceed because one or more source companies were not found.");
  }

  if (!plan.preview.allowed) {
    throw new Error(plan.preview.warnings[0] ?? "Company merge is not allowed for this pair.");
  }

  if (input.session.persistenceMode === "database") {
    await executeCompanyMergeInDatabase({
      session: input.session,
      target: context.target,
      sourceCompanyIds: plan.sourceCompanyIds,
      mergedThemeIds: plan.mergedThemeIds,
      mergedNotes: plan.mergedNotes,
      rebuiltRelations: plan.rebuiltRelations,
      mergedKeywords: plan.mergedKeywords
    });
  } else {
    await executeCompanyMergeInMemory({
      repo: input.repo,
      target: context.target,
      sourceCompanyIds: plan.sourceCompanyIds,
      mergedThemeIds: plan.mergedThemeIds,
      mergedNotes: plan.mergedNotes,
      rebuiltRelations: plan.rebuiltRelations,
      mergedKeywords: plan.mergedKeywords
    });
  }

  return {
    mergedAt: nowIso(),
    targetCompanyId: context.target.id,
    deletedCompanyIds: plan.sourceCompanyIds,
    impact: plan.preview.impact,
    warnings: plan.preview.warnings
  } satisfies CompanyMergeResult;
}

// ── Upsert helper (post-0020 import path) ────────────────────────────────────
//
// After migration 0020 adds UNIQUE(workspace_id, ticker), the import endpoint
// should call this instead of repo.createCompany() to handle re-runs gracefully.
// Without this, a second import run throws a UNIQUE constraint violation.
//
// Pre-0020: behaves as a regular insert (no conflict match, UNIQUE not yet enforced).
// Post-0020: updates in place on ticker collision.
//
// CompanyCreateInput is imported at the top of this file.

export async function upsertCompanyOnConflict(
  input: CompanyCreateInput & { workspaceId: string }
): Promise<{ id: string; ticker: string; upserted: boolean }> {
  const db = getDb();

  const values = {
    workspaceId: input.workspaceId,
    name: input.name,
    ticker: input.ticker,
    market: input.market,
    country: input.country,
    chainPosition: input.chainPosition,
    beneficiaryTier: input.beneficiaryTier,
    exposure: input.exposure,
    validation: input.validation,
    notes: input.notes,
    updatedAt: new Date()
  };

  const [row] = await db
    .insert(companies)
    .values(values)
    .onConflictDoUpdate({
      target: [companies.workspaceId, companies.ticker],
      set: {
        name: values.name,
        market: values.market,
        country: values.country,
        chainPosition: values.chainPosition,
        beneficiaryTier: values.beneficiaryTier,
        exposure: values.exposure,
        validation: values.validation,
        notes: values.notes,
        updatedAt: values.updatedAt
      }
    })
    .returning({ id: companies.id, ticker: companies.ticker });

  return { id: row.id, ticker: row.ticker, upserted: true };
}
