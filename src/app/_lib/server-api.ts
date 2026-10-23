import "server-only";

// Single import point for the Database Engine agent's server functions.
// When its domain barrels land, only this file changes.
export {
  getBranch,
  getVehicle,
  listBranches,
  listCategories,
  listExtras,
  listFeatures,
  listVehicles,
  type Branch,
  type Extra,
  type VehicleCategory,
  type VehicleDetails,
} from "@/server/catalog/queries";
export {
  getVehicleCalendar,
  searchAvailability,
  type AvailableVehicle,
  type BusyInterval,
} from "@/server/reservations/availability";
export { MAX_RENTAL_DAYS, quotePrice } from "@/server/pricing/quote";
export type { Quote } from "@/server/pricing/engine";
