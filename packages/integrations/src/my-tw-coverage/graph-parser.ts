import type { CompanySeed, RelationEdge } from "./types.js";

type GraphNode = {
  id: string;
  count: number;
  category: string;
  color?: string;
};

type GraphLink = {
  source: string;
  target: string;
  value?: number;
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

function categoryToRelationType(
  sourceCategory: string,
  targetCategory: string
): RelationEdge["relationType"] {
  if (sourceCategory === "application" || targetCategory === "application") {
    return "application";
  }
  if (sourceCategory === "technology" || targetCategory === "technology") {
    return "technology";
  }
  return "co_occurrence";
}

/**
 * Parse graph_data.json into company seeds and relation edges.
 */
export function parseGraphData(
  jsonContent: string,
  sourcePath: string
): { companies: CompanySeed[]; relations: RelationEdge[] } {
  const data: GraphData = JSON.parse(jsonContent);
  const companies: CompanySeed[] = [];
  const relations: RelationEdge[] = [];

  const nodeMap = new Map<string, GraphNode>();
  for (const node of data.nodes) {
    nodeMap.set(node.id, node);

    if (
      node.category === "taiwan_company" ||
      node.category === "international_company"
    ) {
      companies.push({
        ticker: "",
        displayName: node.id,
        sourcePath
      });
    }
  }

  for (const link of data.links) {
    const sourceNode = nodeMap.get(link.source);
    const targetNode = nodeMap.get(link.target);
    const sourceCategory = sourceNode?.category ?? "unknown";
    const targetCategory = targetNode?.category ?? "unknown";

    relations.push({
      fromLabel: link.source,
      toLabel: link.target,
      relationType: categoryToRelationType(sourceCategory, targetCategory),
      confidence: 0.5,
      sourcePath
    });
  }

  return { companies, relations };
}
