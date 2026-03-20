import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const assetStatusEnum = pgEnum("asset_status", [
  "available",
  "assigned",
  "in_maintenance",
  "retired",
  "lost",
]);

export const assetCategoryEnum = pgEnum("asset_category", [
  "laptop",
  "desktop",
  "monitor",
  "phone",
  "tablet",
  "printer",
  "server",
  "networking",
  "peripheral",
  "other",
]);

export const assetsTable = pgTable("assets", {
  id: text("id").primaryKey(),
  assetTag: text("asset_tag").notNull().unique(),
  name: text("name").notNull(),
  category: assetCategoryEnum("category").notNull(),
  status: assetStatusEnum("status").notNull().default("available"),
  assignedToId: text("assigned_to_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  purchaseDate: text("purchase_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
