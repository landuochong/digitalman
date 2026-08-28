const SESSION_ID_PATTERN = /^ses_[a-f0-9]{32}$/;

export class CodexSessionProxyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createCodexSessionProxy({ baseUrl, token, fetchImpl = fetch }) {
  const enabled = Boolean(baseUrl && token);

  async function request(path, payload) {
    if (!enabled) throw new CodexSessionProxyError("Codex Session Bridge is not configured", 503);
    let response;
    try {
      response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(1500)
      });
    } catch {
      throw new CodexSessionProxyError("Codex Session Bridge is unavailable", 503);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new CodexSessionProxyError(body.error?.message || "Codex Session Bridge rejected the request", response.status);
    }
    return body;
  }

  function requireSessionId(value) {
    const sessionId = String(value || "");
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new CodexSessionProxyError("Invalid session ID");
    return sessionId;
  }

  return {
    enabled,
    start: () => request("/v1/sessions", { character_id: "lumi", locale: "zh-CN" }),
    message: async ({ sessionId, role, text, source }) => {
      const validUser = role === "user" && ["typed", "speech-final"].includes(source);
      const validAssistant = role === "assistant" && source === "assistant-final";
      if (!validUser && !validAssistant) throw new CodexSessionProxyError("Invalid message role or source");
      if (typeof text !== "string" || !text || text.length > 10_000) throw new CodexSessionProxyError("Invalid message text");
      return request(`/v1/sessions/${requireSessionId(sessionId)}/messages`, { role, text, source });
    },
    end: async ({ sessionId }) => request(`/v1/sessions/${requireSessionId(sessionId)}/end`, {})
  };
}
