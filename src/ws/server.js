import { WebSocket, WebSocketServer } from "ws";
import { wsArcjet } from "../arcjet.js";

function sendJson(socket, payload) {
	if (socket.readyState !== WebSocket.OPEN) return;

	socket.send(JSON.stringify(payload));
}

function broadcast(wss, payload) {
	for (const client of wss.clients) {
		if (client.readyState !== WebSocket.OPEN) continue;
		try {
			client.send(JSON.stringify(payload));
		} catch (error) {
			console.error("Failed to broadcast websocket message", error);
		}
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

		sendJson(socket, { type: "welcome" });

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
		broadcast(wss, { type: "match_created", data: match });
	}

	return { broadcastMatchCreated };
}
