import { Checkbox, Field, Input, Select } from "@/components/ui/form";

type Option = { id: string; name: string; code?: string };

export type VehicleDefaults = {
  branchId?: string;
  categoryId?: string;
  make?: string;
  model?: string;
  year?: number;
  plate?: string;
  vin?: string;
  transmission?: string;
  fuelType?: string;
  seats?: number;
  doors?: number;
  luggage?: number;
  color?: string | null;
  mileageKm?: number;
  fuelLevel?: number;
  featureIds?: string[];
};

/** Field set shared by the create and edit vehicle forms. */
export function VehicleFields({
  v = {},
  branches,
  categories,
  features,
}: {
  v?: VehicleDefaults;
  branches: Option[];
  categories: Option[];
  features: Option[];
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Make" htmlFor="v-make">
          <Input id="v-make" name="make" required maxLength={60} defaultValue={v.make} />
        </Field>
        <Field label="Model" htmlFor="v-model">
          <Input id="v-model" name="model" required maxLength={60} defaultValue={v.model} />
        </Field>
        <Field label="Year" htmlFor="v-year">
          <Input id="v-year" name="year" type="number" min={1990} max={2100} required defaultValue={v.year} />
        </Field>
        <Field label="Plate" htmlFor="v-plate">
          <Input id="v-plate" name="plate" required maxLength={20} defaultValue={v.plate} className="uppercase" />
        </Field>
        <Field label="VIN" htmlFor="v-vin" hint="17 characters, no I, O or Q.">
          <Input id="v-vin" name="vin" required minLength={17} maxLength={17} defaultValue={v.vin} className="font-mono uppercase" aria-describedby="v-vin-hint" />
        </Field>
        <Field label="Colour" htmlFor="v-color" optional>
          <Input id="v-color" name="color" maxLength={40} defaultValue={v.color ?? ""} />
        </Field>
        <Field label="Branch" htmlFor="v-branch">
          <Select id="v-branch" name="branchId" required defaultValue={v.branchId ?? ""}>
            <option value="" disabled>
              Choose…
            </option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code ? `${b.code} — ` : ""}
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category" htmlFor="v-category">
          <Select id="v-category" name="categoryId" required defaultValue={v.categoryId ?? ""}>
            <option value="" disabled>
              Choose…
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Transmission" htmlFor="v-trans">
          <Select id="v-trans" name="transmission" defaultValue={v.transmission ?? "AUTOMATIC"}>
            <option value="AUTOMATIC">Automatic</option>
            <option value="MANUAL">Manual</option>
          </Select>
        </Field>
        <Field label="Fuel type" htmlFor="v-fuel">
          <Select id="v-fuel" name="fuelType" defaultValue={v.fuelType ?? "PETROL"}>
            <option value="PETROL">Petrol</option>
            <option value="DIESEL">Diesel</option>
            <option value="HYBRID">Hybrid</option>
            <option value="ELECTRIC">Electric</option>
          </Select>
        </Field>
        <Field label="Seats" htmlFor="v-seats">
          <Input id="v-seats" name="seats" type="number" min={1} max={15} required defaultValue={v.seats ?? 5} />
        </Field>
        <Field label="Doors" htmlFor="v-doors">
          <Input id="v-doors" name="doors" type="number" min={2} max={6} defaultValue={v.doors ?? 4} />
        </Field>
        <Field label="Bags" htmlFor="v-luggage">
          <Input id="v-luggage" name="luggage" type="number" min={0} max={10} defaultValue={v.luggage ?? 2} />
        </Field>
        <Field label="Mileage (km)" htmlFor="v-mileage">
          <Input id="v-mileage" name="mileageKm" type="number" min={0} defaultValue={v.mileageKm ?? 0} />
        </Field>
        <Field label="Fuel level (%)" htmlFor="v-fuellevel">
          <Input id="v-fuellevel" name="fuelLevel" type="number" min={0} max={100} defaultValue={v.fuelLevel ?? 100} />
        </Field>
      </div>
      {features.length ? (
        <fieldset>
          <legend className="text-sm font-medium text-ink-800">Features</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm text-ink-700">
                <Checkbox name="featureIds" value={f.id} defaultChecked={v.featureIds?.includes(f.id)} />
                {f.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
