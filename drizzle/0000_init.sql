CREATE TYPE "public"."damage_severity" AS ENUM('MINOR', 'MODERATE', 'MAJOR');--> statement-breakpoint
CREATE TYPE "public"."damage_status" AS ENUM('OPEN', 'CHARGED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'HELD', 'FAILED', 'RELEASED', 'CAPTURED');--> statement-breakpoint
CREATE TYPE "public"."extra_charge_type" AS ENUM('PER_DAY', 'PER_RENTAL');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_kind" AS ENUM('DAILY_RATE', 'ONE_WAY_FEE', 'VAT', 'DEPOSIT', 'LATE_RETURN');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('PENDING', 'CONFIRMED', 'PICKED_UP', 'RETURNED', 'CANCELLED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('AUTOMATIC', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('AVAILABLE', 'RESERVED', 'ON_RENT', 'MAINTENANCE', 'RETIRED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"address" text NOT NULL,
	"phone" text,
	"timezone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"opening_hours" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code"),
	CONSTRAINT "branches_code_format" CHECK ("branches"."code" ~ '^[A-Z0-9]{2,10}$'),
	CONSTRAINT "branches_timezone_nonempty" CHECK (length("branches"."timezone") > 0)
);
--> statement-breakpoint
CREATE TABLE "damage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"reservation_id" uuid,
	"reported_by_id" uuid,
	"severity" "damage_severity" NOT NULL,
	"status" "damage_status" DEFAULT 'OPEN' NOT NULL,
	"description" text NOT NULL,
	"photo_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"repair_cost_fils" integer,
	"charged_fils" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "damage_reports_money" CHECK (("damage_reports"."repair_cost_fils" is null or "damage_reports"."repair_cost_fils" >= 0) and "damage_reports"."charged_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_hold_id" text,
	"idempotency_key" text NOT NULL,
	"amount_fils" integer NOT NULL,
	"amount_captured_fils" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"released_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_provider_hold_id_unique" UNIQUE("provider_hold_id"),
	CONSTRAINT "deposits_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "deposits_amount_nonneg" CHECK ("deposits"."amount_fils" >= 0),
	CONSTRAINT "deposits_capture_range" CHECK ("deposits"."amount_captured_fils" between 0 and "deposits"."amount_fils")
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"nationality" text NOT NULL,
	"licence_number" text NOT NULL,
	"licence_country" text NOT NULL,
	"licence_expiry" date NOT NULL,
	"licence_file_key" text,
	"licence_content_type" text,
	"licence_uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "driver_profiles_licence_after_birth" CHECK ("driver_profiles"."licence_expiry" > "driver_profiles"."date_of_birth"),
	CONSTRAINT "driver_profiles_phone_len" CHECK (length("driver_profiles"."phone") between 5 and 32)
);
--> statement-breakpoint
CREATE TABLE "extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"charge_type" "extra_charge_type" NOT NULL,
	"price_fils" integer NOT NULL,
	"max_quantity" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extras_code_unique" UNIQUE("code"),
	CONSTRAINT "extras_price_nonneg" CHECK ("extras"."price_fils" >= 0),
	CONSTRAINT "extras_max_quantity" CHECK ("extras"."max_quantity" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "maintenance_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"period" "tstzrange" GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED NOT NULL,
	"reason" text NOT NULL,
	"created_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_blocks_period_valid" CHECK ("maintenance_blocks"."ends_at" > "maintenance_blocks"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"idempotency_key" text NOT NULL,
	"purpose" text DEFAULT 'RENTAL' NOT NULL,
	"amount_fils" integer NOT NULL,
	"amount_refunded_fils" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_pos" CHECK ("payments"."amount_fils" > 0),
	CONSTRAINT "payments_refund_range" CHECK ("payments"."amount_refunded_fils" between 0 and "payments"."amount_fils"),
	CONSTRAINT "payments_purpose" CHECK ("payments"."purpose" in ('RENTAL', 'ADJUSTMENT'))
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "pricing_rule_kind" NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"from_branch_id" uuid,
	"to_branch_id" uuid,
	"min_days" integer DEFAULT 1 NOT NULL,
	"amount_fils" integer,
	"rate_bps" integer,
	"grace_minutes" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_amount_nonneg" CHECK ("pricing_rules"."amount_fils" is null or "pricing_rules"."amount_fils" >= 0),
	CONSTRAINT "pricing_rules_rate_range" CHECK ("pricing_rules"."rate_bps" is null or "pricing_rules"."rate_bps" between 0 and 10000),
	CONSTRAINT "pricing_rules_min_days" CHECK ("pricing_rules"."min_days" >= 1),
	CONSTRAINT "pricing_rules_grace_nonneg" CHECK ("pricing_rules"."grace_minutes" >= 0),
	CONSTRAINT "pricing_rules_valid_range" CHECK ("pricing_rules"."valid_from" is null or "pricing_rules"."valid_to" is null or "pricing_rules"."valid_to" > "pricing_rules"."valid_from"),
	CONSTRAINT "pricing_rules_kind_fields" CHECK (case "pricing_rules"."kind"
        when 'DAILY_RATE' then "pricing_rules"."category_id" is not null and "pricing_rules"."amount_fils" is not null
        when 'VAT' then "pricing_rules"."rate_bps" is not null
        else "pricing_rules"."amount_fils" is not null end)
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_webhook_events_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "rental_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"picked_up_at" timestamp with time zone NOT NULL,
	"pickup_mileage_km" integer NOT NULL,
	"pickup_fuel_level" integer NOT NULL,
	"pickup_staff_id" uuid,
	"pickup_notes" text,
	"returned_at" timestamp with time zone,
	"return_branch_id" uuid,
	"return_mileage_km" integer,
	"return_fuel_level" integer,
	"return_staff_id" uuid,
	"return_notes" text,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"late_fee_fils" integer DEFAULT 0 NOT NULL,
	"damage_charge_fils" integer DEFAULT 0 NOT NULL,
	"deposit_captured_fils" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_agreements_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "rental_agreements_pickup_fuel" CHECK ("rental_agreements"."pickup_fuel_level" between 0 and 100),
	CONSTRAINT "rental_agreements_return_fuel" CHECK ("rental_agreements"."return_fuel_level" is null or "rental_agreements"."return_fuel_level" between 0 and 100),
	CONSTRAINT "rental_agreements_pickup_mileage" CHECK ("rental_agreements"."pickup_mileage_km" >= 0),
	CONSTRAINT "rental_agreements_return_mileage" CHECK ("rental_agreements"."return_mileage_km" is null or "rental_agreements"."return_mileage_km" >= "rental_agreements"."pickup_mileage_km"),
	CONSTRAINT "rental_agreements_return_after_pickup" CHECK ("rental_agreements"."returned_at" is null or "rental_agreements"."returned_at" >= "rental_agreements"."picked_up_at"),
	CONSTRAINT "rental_agreements_money" CHECK ("rental_agreements"."late_minutes" >= 0 and "rental_agreements"."late_fee_fils" >= 0 and "rental_agreements"."damage_charge_fils" >= 0 and "rental_agreements"."deposit_captured_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_extras" (
	"reservation_id" uuid NOT NULL,
	"extra_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_fils" integer NOT NULL,
	"charge_type" "extra_charge_type" NOT NULL,
	"total_fils" integer NOT NULL,
	CONSTRAINT "reservation_extras_reservation_id_extra_id_pk" PRIMARY KEY("reservation_id","extra_id"),
	CONSTRAINT "reservation_extras_quantity" CHECK ("reservation_extras"."quantity" >= 1),
	CONSTRAINT "reservation_extras_money" CHECK ("reservation_extras"."unit_price_fils" >= 0 and "reservation_extras"."total_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"pickup_branch_id" uuid NOT NULL,
	"return_branch_id" uuid NOT NULL,
	"pickup_at" timestamp with time zone NOT NULL,
	"return_at" timestamp with time zone NOT NULL,
	"period" "tstzrange" GENERATED ALWAYS AS (tstzrange(pickup_at, return_at, '[)')) STORED NOT NULL,
	"status" "reservation_status" DEFAULT 'PENDING' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"rental_days" integer NOT NULL,
	"daily_rate_fils" integer NOT NULL,
	"base_fils" integer NOT NULL,
	"extras_fils" integer NOT NULL,
	"one_way_fee_fils" integer NOT NULL,
	"subtotal_fils" integer NOT NULL,
	"vat_rate_bps" integer NOT NULL,
	"vat_fils" integer NOT NULL,
	"total_fils" integer NOT NULL,
	"deposit_fils" integer NOT NULL,
	"quote" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_reference_unique" UNIQUE("reference"),
	CONSTRAINT "reservations_period_valid" CHECK ("reservations"."return_at" > "reservations"."pickup_at"),
	CONSTRAINT "reservations_pending_has_hold" CHECK ("reservations"."status" <> 'PENDING' or "reservations"."hold_expires_at" is not null),
	CONSTRAINT "reservations_money_nonneg" CHECK ("reservations"."daily_rate_fils" >= 0 and "reservations"."base_fils" >= 0 and "reservations"."extras_fils" >= 0 and "reservations"."one_way_fee_fils" >= 0
        and "reservations"."subtotal_fils" >= 0 and "reservations"."vat_fils" >= 0 and "reservations"."total_fils" >= 0 and "reservations"."deposit_fils" >= 0),
	CONSTRAINT "reservations_total_sum" CHECK ("reservations"."total_fils" = "reservations"."subtotal_fils" + "reservations"."vat_fils"),
	CONSTRAINT "reservations_days_pos" CHECK ("reservations"."rental_days" >= 1),
	CONSTRAINT "reservations_vat_range" CHECK ("reservations"."vat_rate_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"reservation_id" uuid,
	"maintenance_block_id" uuid,
	"hold_expires_at" timestamp with time zone,
	CONSTRAINT "vehicle_bookings_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "vehicle_bookings_maintenance_block_id_unique" UNIQUE("maintenance_block_id"),
	CONSTRAINT "vehicle_bookings_one_source" CHECK (num_nonnulls("vehicle_bookings"."reservation_id", "vehicle_bookings"."maintenance_block_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "vehicle_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_categories_code_unique" UNIQUE("code"),
	CONSTRAINT "vehicle_categories_code_format" CHECK ("vehicle_categories"."code" ~ '^[A-Z0-9_]{2,20}$')
);
--> statement-breakpoint
CREATE TABLE "vehicle_feature_map" (
	"vehicle_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	CONSTRAINT "vehicle_feature_map_vehicle_id_feature_id_pk" PRIMARY KEY("vehicle_id","feature_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_features_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"plate" text NOT NULL,
	"vin" text NOT NULL,
	"transmission" "transmission" NOT NULL,
	"fuel_type" "fuel_type" NOT NULL,
	"seats" integer NOT NULL,
	"doors" integer DEFAULT 4 NOT NULL,
	"luggage" integer DEFAULT 2 NOT NULL,
	"color" text,
	"mileage_km" integer DEFAULT 0 NOT NULL,
	"fuel_level" integer DEFAULT 100 NOT NULL,
	"status" "vehicle_status" DEFAULT 'AVAILABLE' NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_unique" UNIQUE("plate"),
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin"),
	CONSTRAINT "vehicles_year_range" CHECK ("vehicles"."year" between 1990 and 2100),
	CONSTRAINT "vehicles_seats_range" CHECK ("vehicles"."seats" between 1 and 15),
	CONSTRAINT "vehicles_doors_range" CHECK ("vehicles"."doors" between 2 and 6),
	CONSTRAINT "vehicles_luggage_range" CHECK ("vehicles"."luggage" between 0 and 10),
	CONSTRAINT "vehicles_mileage_nonneg" CHECK ("vehicles"."mileage_km" >= 0),
	CONSTRAINT "vehicles_fuel_range" CHECK ("vehicles"."fuel_level" between 0 and 100),
	CONSTRAINT "vehicles_vin_format" CHECK ("vehicles"."vin" ~ '^[A-HJ-NPR-Z0-9]{17}$')
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_pickup_staff_id_users_id_fk" FOREIGN KEY ("pickup_staff_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_return_staff_id_users_id_fk" FOREIGN KEY ("return_staff_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_extra_id_extras_id_fk" FOREIGN KEY ("extra_id") REFERENCES "public"."extras"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_maintenance_block_id_maintenance_blocks_id_fk" FOREIGN KEY ("maintenance_block_id") REFERENCES "public"."maintenance_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_feature_id_vehicle_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."vehicle_features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "damage_reports_vehicle_id_idx" ON "damage_reports" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "damage_reports_reservation_id_idx" ON "damage_reports" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "damage_reports_reported_by_id_idx" ON "damage_reports" USING btree ("reported_by_id");--> statement-breakpoint
CREATE INDEX "deposits_reservation_id_idx" ON "deposits" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "deposits_status_idx" ON "deposits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "maintenance_blocks_vehicle_id_idx" ON "maintenance_blocks" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "maintenance_blocks_created_by_id_idx" ON "maintenance_blocks" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "payments_reservation_id_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "pricing_rules_kind_idx" ON "pricing_rules" USING btree ("kind","is_active");--> statement-breakpoint
CREATE INDEX "pricing_rules_category_id_idx" ON "pricing_rules" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "pricing_rules_from_branch_id_idx" ON "pricing_rules" USING btree ("from_branch_id");--> statement-breakpoint
CREATE INDEX "pricing_rules_to_branch_id_idx" ON "pricing_rules" USING btree ("to_branch_id");--> statement-breakpoint
CREATE INDEX "rental_agreements_pickup_staff_id_idx" ON "rental_agreements" USING btree ("pickup_staff_id");--> statement-breakpoint
CREATE INDEX "rental_agreements_return_staff_id_idx" ON "rental_agreements" USING btree ("return_staff_id");--> statement-breakpoint
CREATE INDEX "rental_agreements_return_branch_id_idx" ON "rental_agreements" USING btree ("return_branch_id");--> statement-breakpoint
CREATE INDEX "reservation_extras_extra_id_idx" ON "reservation_extras" USING btree ("extra_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_user_idempotency_key" ON "reservations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "reservations_user_id_idx" ON "reservations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reservations_vehicle_id_idx" ON "reservations" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "reservations_pickup_branch_id_idx" ON "reservations" USING btree ("pickup_branch_id");--> statement-breakpoint
CREATE INDEX "reservations_return_branch_id_idx" ON "reservations" USING btree ("return_branch_id");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reservations_pending_hold_idx" ON "reservations" USING btree ("hold_expires_at") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "reservations_pickup_at_idx" ON "reservations" USING btree ("pickup_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vehicle_bookings_vehicle_id_idx" ON "vehicle_bookings" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_feature_map_feature_id_idx" ON "vehicle_feature_map" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "vehicles_branch_id_idx" ON "vehicles" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "vehicles_category_id_idx" ON "vehicles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "vehicles_status_idx" ON "vehicles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");