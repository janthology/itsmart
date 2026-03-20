import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { assetsTable } from "./assets";

export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "in_progress",
  "on_hold",
  "resolved",
  "closed",
]);

export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const ticketsTable = pgTable("tickets", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: ticketStatusEnum("status").notNull().default("open"),
  priority: ticketPriorityEnum("priority").notNull(),
  assetId: text("asset_id").references(() => assetsTable.id, {
    onDelete: "set null",
  }),
  createdById: text("created_by_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  assignedToId: text("assigned_to_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const ticketCommentsTable = pgTable("ticket_comments", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id")
    .notNull()
    .references(() => ticketsTable.id, { onDelete: "cascade" }),
  createdById: text("created_by_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  commentText: text("comment_text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
});

export const insertTicketCommentSchema = createInsertSchema(
  ticketCommentsTable
).omit({
  id: true,
  createdAt: true,
});

export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
export type InsertTicketComment = z.infer<typeof insertTicketCommentSchema>;
export type TicketComment = typeof ticketCommentsTable.$inferSelect;
