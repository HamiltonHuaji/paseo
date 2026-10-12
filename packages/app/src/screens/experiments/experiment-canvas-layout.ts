import type {
  ExperimentRecord,
  ExperimentDetail,
  ExperimentBoardPlacement,
} from "@getpaseo/protocol/experiments";
import * as board from "@/components/board-canvas/layout";
import { selectCardProgressAttempts } from "./experiment-progress-state";
export const EXPERIMENT_CANVAS_GRID_SIZE = board.BOARD_CANVAS_GRID_SIZE;
export const EXPERIMENT_CANVAS_MIN_ROWS = board.BOARD_CANVAS_MIN_ROWS;
export type ResolvedPlacement = Omit<board.ResolvedPlacement, "id"> & { experiment: string };
export const boardNodes = (records: ExperimentRecord[]): board.BoardNode[] =>
  records.map((value) => ({ ...value, title: value.shortDescription }));
export const boardSizes = (
  records: ExperimentRecord[],
  details: Map<string, ExperimentDetail>,
): Map<string, board.BoardSize> =>
  new Map(
    records.map((value) => {
      const detail = details.get(value.id);
      return [
        value.id,
        {
          width: value.shortDescription.length > 48 ? 14 : 12,
          height: detail && selectCardProgressAttempts(detail).length ? 8 : 7,
        },
      ];
    }),
  );
export function toBoardPlacement(p: ExperimentBoardPlacement): board.BoardPlacement {
  const { experiment, ...rest } = p;
  return { ...rest, id: experiment };
}
export function fromBoardPlacement(p: board.BoardPlacement): ExperimentBoardPlacement {
  const { id, ...rest } = p;
  return { ...rest, experiment: id };
}
const resolved = (p: board.ResolvedPlacement): ResolvedPlacement => ({
  experiment: p.id,
  column: p.column,
  row: p.row,
  width: p.width,
  height: p.height,
});
const mapped = (p: Map<string, board.ResolvedPlacement>) =>
  new Map([...p].map(([id, value]) => [id, resolved(value)]));
const inverse = (p: Map<string, ResolvedPlacement>): Map<string, board.ResolvedPlacement> =>
  new Map([...p].map(([id, value]) => [id, { ...value, id }]));
export function buildAutomaticLayout(
  records: ExperimentRecord[],
  details: Map<string, ExperimentDetail>,
  placements: ExperimentBoardPlacement[] = [],
) {
  return mapped(
    board.buildAutomaticLayout(
      boardNodes(records),
      boardSizes(records, details),
      placements.map(toBoardPlacement),
    ),
  );
}
export function resolveBoardPlacements(
  records: ExperimentRecord[],
  details: Map<string, ExperimentDetail>,
  placements: ExperimentBoardPlacement[],
) {
  return mapped(
    board.resolveBoardPlacements(
      boardNodes(records),
      boardSizes(records, details),
      placements.map(toBoardPlacement),
    ),
  );
}
export function arrangeLineageTrees(
  records: ExperimentRecord[],
  placements: Map<string, ResolvedPlacement>,
) {
  return board.arrangeLineageTrees(boardNodes(records), inverse(placements)).map(resolved);
}
export function resolvePlacement(
  stored: ExperimentBoardPlacement | undefined,
  automatic: ResolvedPlacement,
) {
  return resolved(
    board.resolvePlacement(stored ? toBoardPlacement(stored) : undefined, {
      ...automatic,
      id: automatic.experiment,
    }),
  );
}
export function fallbackPlacement(id: string, index: number) {
  return resolved(board.fallbackPlacement(id, index));
}
export function canvasDimensions(placements: Map<string, ResolvedPlacement>) {
  return board.canvasDimensions(inverse(placements));
}
export function orthogonalRoute(source: ResolvedPlacement, target: ResolvedPlacement) {
  return board.orthogonalRoute(
    { ...source, id: source.experiment },
    { ...target, id: target.experiment },
  );
}
