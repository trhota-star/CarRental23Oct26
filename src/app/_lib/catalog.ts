import "server-only";
import { listBranches, listCategories, type Branch, type VehicleCategory } from "./server-api";

export type PublicBranch = Branch;
export type PublicCategory = VehicleCategory;

export function getActiveBranches(): Promise<PublicBranch[]> {
  return listBranches();
}

export function getCategories(): Promise<PublicCategory[]> {
  return listCategories();
}
