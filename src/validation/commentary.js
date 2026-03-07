import { z } from "zod";

export const listCommentaryQuerySchema = z.object({
	limit: z.coerce.number().int().positive().max(100).optional(),
});

export const createCommentarySchema = z.object({
	minute: z.number().int().min(0),
	sequence: z.number().int().min(0).optional(),
	period: z.string().min(1).optional(),
	eventType: z.string().min(1).optional(),
	actor: z.string().min(1).optional(),
	team: z.string().min(1).optional(),
	message: z.string().min(1),
	metadata: z.record(z.string(), z.unknown()).optional(),
	tags: z.array(z.string()).optional(),
});
