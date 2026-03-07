import { desc, eq } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/db.js";
import { commentary } from "../db/schema.js";
import {
	createCommentarySchema,
	listCommentaryQuerySchema,
} from "../validation/commentary.js";
import { matchIdParamSchema } from "../validation/matches.js";

export const commentaryRouter = Router({ mergeParams: true });

const MAX_LIMIT = 100;

commentaryRouter.get("/", async (req, res) => {
	const parsedParams = matchIdParamSchema.safeParse(req.params);

	if (!parsedParams.success) {
		return res.status(400).json({
			error: "Invalid match ID",
			details: parsedParams.error.issues,
		});
	}

	const parsedQuery = listCommentaryQuerySchema.safeParse(req.query);

	if (!parsedQuery.success) {
		return res.status(400).json({
			error: "Invalid query parameters",
			details: parsedQuery.error.issues,
		});
	}

	const limit = Math.min(parsedQuery.data.limit ?? MAX_LIMIT, MAX_LIMIT);

	try {
		const data = await db
			.select()
			.from(commentary)
			.where(eq(commentary.matchId, parsedParams.data.id))
			.orderBy(desc(commentary.createdAt))
			.limit(limit);

		res.json({ data });
	} catch {
		res.status(500).json({ error: "Failed to fetch commentary." });
	}
});

commentaryRouter.post("/", async (req, res) => {
	const parsedParams = matchIdParamSchema.safeParse(req.params);

	if (!parsedParams.success) {
		return res.status(400).json({
			error: "Invalid match ID",
			details: parsedParams.error.issues,
		});
	}

	const parsedBody = createCommentarySchema.safeParse(req.body);

	if (!parsedBody.success) {
		return res.status(400).json({
			error: "Invalid request data",
			details: parsedBody.error.issues,
		});
	}

	try {
		const [result] = await db
			.insert(commentary)
			.values({
				...parsedBody.data,
				matchId: parsedParams.data.id,
			})
			.returning();

		if (res.app.locals.broadcastCommentary) {
			res.app.locals.broadcastCommentary(result.matchId, result);
		}

		res.status(201).json({ data: result });
	} catch (e) {
		res.status(500).json({
			error: "Failed to create commentary.",
			details: JSON.stringify(e),
		});
	}
});
