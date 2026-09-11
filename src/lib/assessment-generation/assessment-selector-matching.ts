import { createHash } from "node:crypto";

import type { BlueprintSelector } from "./assessment-blueprint-domain";
import type {
  QuestionDifficulty,
  QuestionType
} from "../question-bank/question-bank-domain";

export type AssessmentSelectionCandidate = Readonly<{
  questionId: string;
  questionVersionId: string;
  questionType: QuestionType;
  domainReference: string;
  difficulty: QuestionDifficulty;
  tags: readonly string[];
}>;

export type AssessmentCandidateAllocation = Readonly<{
  selectorIndex: number;
  candidate: AssessmentSelectionCandidate;
}>;

type Edge = {
  to: number;
  reverse: number;
  capacity: number;
  originalCapacity: number;
};

function selectorMatches(
  candidate: AssessmentSelectionCandidate,
  selector: BlueprintSelector
): boolean {
  if (selector.questionType && candidate.questionType !== selector.questionType) {
    return false;
  }
  if (
    selector.domainReference &&
    candidate.domainReference !== selector.domainReference
  ) {
    return false;
  }
  if (selector.difficulty && candidate.difficulty !== selector.difficulty) {
    return false;
  }
  const tags = new Set(candidate.tags);
  return selector.tagsAll.every((tag) => tags.has(tag));
}

function rank(
  nonceHex: string,
  selectorIndex: number | "candidate",
  candidate: AssessmentSelectionCandidate
): string {
  return createHash("sha256")
    .update(
      `${nonceHex}:${selectorIndex}:${candidate.questionId}:${candidate.questionVersionId}`,
      "utf8"
    )
    .digest("hex");
}

function addEdge(graph: Edge[][], from: number, to: number, capacity: number): Edge {
  const forward: Edge = {
    to,
    reverse: graph[to].length,
    capacity,
    originalCapacity: capacity
  };
  const reverse: Edge = {
    to: from,
    reverse: graph[from].length,
    capacity: 0,
    originalCapacity: 0
  };
  graph[from].push(forward);
  graph[to].push(reverse);
  return forward;
}

function maxFlow(graph: Edge[][], source: number, sink: number): number {
  let total = 0;
  while (true) {
    const parentNode = Array.from({ length: graph.length }, () => -1);
    const parentEdge = Array.from({ length: graph.length }, () => -1);
    const queue = [source];
    parentNode[source] = source;

    for (let cursor = 0; cursor < queue.length && parentNode[sink] === -1; cursor += 1) {
      const node = queue[cursor];
      for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex += 1) {
        const edge = graph[node][edgeIndex];
        if (edge.capacity <= 0 || parentNode[edge.to] !== -1) continue;
        parentNode[edge.to] = node;
        parentEdge[edge.to] = edgeIndex;
        queue.push(edge.to);
        if (edge.to === sink) break;
      }
    }

    if (parentNode[sink] === -1) return total;

    let node = sink;
    while (node !== source) {
      const from = parentNode[node];
      const edgeIndex = parentEdge[node];
      const edge = graph[from][edgeIndex];
      edge.capacity -= 1;
      graph[node][edge.reverse].capacity += 1;
      node = from;
    }
    total += 1;
  }
}

export function allocateBlueprintCandidates(
  selectors: readonly BlueprintSelector[],
  candidates: readonly AssessmentSelectionCandidate[],
  nonceHex: string
): readonly AssessmentCandidateAllocation[] | null {
  if (!/^[a-f0-9]{64}$/.test(nonceHex)) {
    throw new Error("Assessment selection nonce is invalid.");
  }
  const required = selectors.reduce((sum, selector) => sum + selector.count, 0);
  if (required < 1 || required > 500 || candidates.length < required) return null;

  const stableIds = new Set<string>();
  for (const candidate of candidates) {
    if (stableIds.has(candidate.questionId)) {
      throw new Error("Assessment selection candidates contain duplicate stable question ids.");
    }
    stableIds.add(candidate.questionId);
  }

  const orderedCandidates = [...candidates].sort((left, right) => {
    const leftRank = rank(nonceHex, "candidate", left);
    const rightRank = rank(nonceHex, "candidate", right);
    return leftRank === rightRank
      ? left.questionId.localeCompare(right.questionId)
      : leftRank.localeCompare(rightRank);
  });

  const source = 0;
  const candidateStart = 1;
  const selectorStart = candidateStart + orderedCandidates.length;
  const sink = selectorStart + selectors.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const assignmentEdges: Array<
    Array<{ selectorIndex: number; edge: Edge }>
  > = Array.from({ length: orderedCandidates.length }, () => []);

  for (let candidateIndex = 0; candidateIndex < orderedCandidates.length; candidateIndex += 1) {
    const candidate = orderedCandidates[candidateIndex];
    const candidateNode = candidateStart + candidateIndex;
    addEdge(graph, source, candidateNode, 1);

    const matchingSelectors = selectors
      .map((selector, selectorIndex) => ({ selector, selectorIndex }))
      .filter(({ selector }) => selectorMatches(candidate, selector))
      .sort((left, right) => {
        const leftRank = rank(nonceHex, left.selectorIndex, candidate);
        const rightRank = rank(nonceHex, right.selectorIndex, candidate);
        return leftRank === rightRank
          ? left.selectorIndex - right.selectorIndex
          : leftRank.localeCompare(rightRank);
      });

    for (const { selectorIndex } of matchingSelectors) {
      const edge = addEdge(
        graph,
        candidateNode,
        selectorStart + selectorIndex,
        1
      );
      assignmentEdges[candidateIndex].push({ selectorIndex, edge });
    }
  }

  for (let selectorIndex = 0; selectorIndex < selectors.length; selectorIndex += 1) {
    addEdge(
      graph,
      selectorStart + selectorIndex,
      sink,
      selectors[selectorIndex].count
    );
  }

  if (maxFlow(graph, source, sink) !== required) return null;

  const grouped: AssessmentCandidateAllocation[][] = Array.from(
    { length: selectors.length },
    () => []
  );
  for (let candidateIndex = 0; candidateIndex < orderedCandidates.length; candidateIndex += 1) {
    const candidate = orderedCandidates[candidateIndex];
    for (const { selectorIndex, edge } of assignmentEdges[candidateIndex]) {
      if (edge.originalCapacity === 1 && edge.capacity === 0) {
        grouped[selectorIndex].push(
          Object.freeze({ selectorIndex, candidate })
        );
      }
    }
  }

  for (let selectorIndex = 0; selectorIndex < grouped.length; selectorIndex += 1) {
    if (grouped[selectorIndex].length !== selectors[selectorIndex].count) return null;
    grouped[selectorIndex].sort((left, right) => {
      const leftRank = rank(nonceHex, selectorIndex, left.candidate);
      const rightRank = rank(nonceHex, selectorIndex, right.candidate);
      return leftRank === rightRank
        ? left.candidate.questionId.localeCompare(right.candidate.questionId)
        : leftRank.localeCompare(rightRank);
    });
  }

  return Object.freeze(grouped.flat().map((entry) => Object.freeze(entry)));
}
