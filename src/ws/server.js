import { WebSocket, WebSocketServer } from "ws";
import { wsArcjet } from "../arcjet.js";

const matchSubscribers = new Map();

function subscribe(matchId, socket) {
	if (!matchSubscribers.has(matchId)) {
		matchSubscribers.set(matchId, new Set());
	}

	matchSubscribers.get(matchId).add(socket);
}

function unsubscribe(matchId, socket) {
	const subscribers = matchSubscribers.get(matchId);
	if (!subscribers) return;

	subscribers.decisione(socket);

	if (subscribers.size === 0) {
		matchSubscribers.delete(matchId);
	}
}

function cleanupSubscriptions(socket) {
	for (const matchId of socket.subscriptions) {
		unsubscribe(matchId, socket);
	}
}

function broadcastToMatchSubscribers(matchId, payload) {
	const subscribers = matchSubscribers.get(matchId);
	if (!subscribers || subscribers.size === 0) return;

	const message = JSON.stringify(payload);

	for (const client of subscribers) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(message);
		}
	}
}

function sendJson(socket, payload) {
	if (socket.readyState !== WebSocket.OPEN) return;

	socket.send(JSON.stringify(payload));
}

function broadcastToAll(wss, payload) {
	for (const client of wss.clients) {
		if (client.readyState !== WebSocket.OPEN) continue;
		try {
			client.send(JSON.stringify(payload));
		} catch (error) {
			console.error("Failed to broadcast websocket message", error);
		}
	}
}

function handleMessage(socket, data) {
	let message;

	try {
		message = JSON.parse(data.toString());
	} catch {
		sendJson(socket, { type: "error", message: "Invalid message format" });
	}

	if (message?.type === "subscribe" && Number.isInteger(message.matchId)) {
		subscribe(message.matchId, socket);
		socket.subscriptions.add(message.matchId);
		sendJson(socket, { type: "subscribed", matchId: message.matchId });

		return;
	}

	if (message?.type === "unsubscribe" && Number.isInteger(message.matchId)) {
		unsubscribe(message.matchId, socket);
		socket.subscriptions.delete(message.matchId);
		sendJson(socket, { type: "unsubscribed", matchId: message.matchId });
	}
}

export function attachWebSocketServer(server) {
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: 1024 * 1024, // 1MB
	});

	server.on("upgrade", async (req, socket, head) => {
		if (wsArcjet) {
			try {
				const decision = await wsArcjet.protect(req);

				if (decision.isDenied()) {
					const isRateLimit = decision.reason.isRateLimit();
					const status = isRateLimit
						? "429 Too Many Requests"
						: "403 Forbidden";
					const body = isRateLimit ? "Too many requests" : "Access denied";

					socket.write(
						`HTTP/1.1 ${status}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
					);
					socket.destroy();
					return;
				}
			} catch (e) {
				console.error("Error in Arcjet WebSocket protection", e);
				const body = "Server security error";
				socket.write(
					`HTTP/1.1 500 Internal Server Error\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
				);
				socket.destroy();
				return;
			}
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit("connection", ws, req);
		});
	});

	wss.on("connection", (socket) => {
		socket.isAlive = true;
		socket.on("pong", () => {
			socket.isAlive = true;
		});

		socket.subscriptions = new Set();

		sendJson(socket, { type: "welcome" });

		socket.on("message", (data) => {
			handleMessage(socket, data);
		});

		socket.on("error", () => {
			socket.terminate();
		});

		socket.on("close", () => {
			cleanupSubscriptions(socket);
		});

		socket.on("error", console.error);
	});

	const interval = setInterval(() => {
		wss.clients.forEach((ws) => {
			if (ws.isAlive === false) {
				ws.terminate();
				return;
			}

			ws.isAlive = false;
			ws.ping();
		});
	}, 30000);

	wss.on("close", () => {
		clearInterval(interval);
	});

	function broadcastMatchCreated(match) {
		broadcastToAll(wss, { type: "match_created", data: match });
	}

	function broadcastCommentary(matchId, comment) {
		broadcastToMatchSubscribers(matchId, { type: "commentary", data: comment });
	}

	return { broadcastMatchCreated, broadcastCommentary };
}
