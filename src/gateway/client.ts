const DEFAULT_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const MAX_BACKOFF_MS = 60_000;
const FATAL_CODES = [4004, 4010, 4011, 4012, 4013, 4014];

export interface GatewayClientOptions {
  token: string;
  intents: number;
  gatewayUrl?: string;
  properties?: { os?: string; browser?: string; device?: string };
}

type EventHandler = (data: any) => void;

export function createGatewayClient(opts: GatewayClientOptions) {
  const {
    token,
    intents,
    gatewayUrl = DEFAULT_GATEWAY_URL,
    properties = { os: "Windows", browser: "Chrome", device: "" },
  } = opts;

  let ws: WebSocket | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let sequence: number | null = null;
  let sessionId: string | null = null;
  let resumeGatewayUrl: string | null = null;
  let isConnecting = false;
  let reconnectScheduled = false;
  let consecutiveFailures = 0;

  const handlers: Map<string, EventHandler[]> = new Map();

  function on(event: string, handler: EventHandler): void {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event)!.push(handler);
  }

  function emit(event: string, data: any): void {
    const list = handlers.get(event);
    if (list) {
      for (const handler of list) {
        try {
          handler(data);
        } catch (err: any) {
          console.error(`Event handler error (${event}): ${err.message}`);
        }
      }
    }
  }

  function log(msg: string): void {
    console.log(`[${new Date().toISOString()}] ${msg}`);
  }

  function sendGateway(op: number, d: any): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op, d }));
    }
  }

  function identify(): void {
    sendGateway(2, {
      token,
      intents,
      properties,
      presence: { status: "online", afk: false },
    });
    log("Sent IDENTIFY");
  }

  function resume(): void {
    sendGateway(6, { token, session_id: sessionId, seq: sequence });
    log("Sent RESUME");
  }

  function startHeartbeat(intervalMs: number): void {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    const jitter = Math.random() * intervalMs;
    setTimeout(() => sendGateway(1, sequence), jitter);
    heartbeatInterval = setInterval(() => sendGateway(1, sequence), intervalMs);
    log(`Heartbeat started: every ${intervalMs}ms`);
  }

  function getBackoffDelay(): number {
    const base = Math.min(2000 * Math.pow(2, consecutiveFailures), MAX_BACKOFF_MS);
    return base + Math.random() * Math.min(base * 0.5, 5000);
  }

  function scheduleReconnect(url?: string): void {
    if (reconnectScheduled || isConnecting) return;
    reconnectScheduled = true;
    const delay = getBackoffDelay();
    log(`Reconnecting in ${Math.round(delay)}ms (attempt ${consecutiveFailures + 1})...`);
    setTimeout(() => {
      reconnectScheduled = false;
      connect(url);
    }, delay);
  }

  function connect(url?: string): void {
    if (isConnecting) {
      log("connect() called but already connecting -- ignoring");
      return;
    }
    isConnecting = true;
    reconnectScheduled = false;

    if (ws) {
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      } catch {}
      ws = null;
    }

    const connectUrl = url || gatewayUrl;
    log(`Connecting to gateway: ${connectUrl}`);
    ws = new WebSocket(connectUrl);

    ws.onopen = () => {
      log("Gateway connected");
      isConnecting = false;
    };

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data as string);
      const { op, t, s, d } = payload;
      if (s !== null) sequence = s;

      switch (op) {
        case 10: // HELLO
          startHeartbeat(d.heartbeat_interval);
          if (sessionId && resumeGatewayUrl) resume();
          else identify();
          break;
        case 11: // HEARTBEAT_ACK
          break;
        case 7: // RECONNECT
          log("Server requested reconnect");
          ws?.close();
          break;
        case 9: // INVALID_SESSION
          log(`Invalid session (resumable: ${d})`);
          consecutiveFailures++;
          if (!d) {
            sessionId = null;
            resumeGatewayUrl = null;
            scheduleReconnect();
            try {
              ws?.close();
            } catch {}
          } else {
            setTimeout(() => resume(), getBackoffDelay());
          }
          break;
        case 0: // DISPATCH
          handleDispatch(t, d);
          break;
      }
    };

    ws.onclose = (event) => {
      log(`Gateway closed: ${event.code} ${event.reason}`);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      isConnecting = false;

      if (FATAL_CODES.includes(event.code)) {
        console.error(`Fatal gateway close code ${event.code} -- stopping. Check your token.`);
        emit("FATAL", { code: event.code, reason: event.reason });
        return;
      }

      consecutiveFailures++;
      scheduleReconnect(resumeGatewayUrl || undefined);
    };

    ws.onerror = (event) => {
      console.error("Gateway error:", event);
    };
  }

  function handleDispatch(eventName: string, data: any): void {
    switch (eventName) {
      case "READY":
        sessionId = data.session_id;
        resumeGatewayUrl = data.resume_gateway_url;
        consecutiveFailures = 0;
        log(`Ready! Logged in as ${data.user?.username} (${data.user?.id})`);
        log(`Session: ${sessionId}`);
        emit("READY", data);
        break;

      case "RESUMED":
        consecutiveFailures = 0;
        log("Session resumed successfully");
        emit("RESUMED", data);
        break;

      case "MESSAGE_CREATE":
        emit("MESSAGE_CREATE", data);
        break;

      default:
        emit(eventName, data);
        break;
    }
  }

  function close(): void {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (ws) {
      try {
        ws.onclose = null;
        ws.close();
      } catch {}
    }
  }

  return { connect, close, on };
}

export type GatewayClient = ReturnType<typeof createGatewayClient>;
