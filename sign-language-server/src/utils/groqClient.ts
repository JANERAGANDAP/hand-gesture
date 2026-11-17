export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export async function callGroq(
  messages: GroqMessage[],
  model?: string,
): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        messages,
        temperature: 0.2,
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Groq request failed with status ${response.status}${body ? `: ${body}` : ""}`,
    );
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
}
