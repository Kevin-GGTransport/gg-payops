import "server-only";
import { todayIso } from "@/lib/format";

/** One recognized trip row on a handwritten PU/DEL record photo */
export type OcrTripRow = {
  date: string;
  load_no: string;
  from_zip: string;
  to_zip: string;
  /** Raw nature text, e.g. "HW - MCE1" (kept for the preview UI) */
  nature: string;
  operation: string;
  note: string;
};

/** One recognized photo: header info plus its trip rows */
export type OcrSheet = {
  driver_name: string;
  /** Truck number as written on the sheet, e.g. "0608" (matches drivers.driver_code) */
  driver_code: string;
  rows: OcrTripRow[];
};

/** Strict JSON schema handed to the model so the reply parses without guesswork */
function responseSchema(operations: string[]) {
  return {
    type: "object",
    name: "pu_del_record",
    additionalProperties: false,
    required: ["driver_name", "driver_code", "rows"],
    properties: {
      driver_name: { type: "string" },
      driver_code: { type: "string" },
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["date", "load_no", "from_zip", "to_zip", "nature", "operation", "note"],
          properties: {
            date: { type: "string", description: "Trip date as YYYY-MM-DD" },
            load_no: { type: "string", description: "Container number without #; empty when no container" },
            from_zip: { type: "string" },
            to_zip: { type: "string" },
            nature: { type: "string", description: "Raw From-To codes as written, e.g. HW - MCE1" },
            operation: { type: "string", enum: operations },
            note: { type: "string", description: "Detention times / 还柜 / 等卸 etc.; empty if none" }
          }
        }
      }
    }
  };
}

const SYSTEM_PROMPT = `You read photos of handwritten Chinese drayage pickup/delivery sheets ("海柜提卸货记录 / PU DEL Record").
Each sheet is one driver's weekly log. The printed header has: 日期/Date, 柜号 (container #), Nature, From Zip, To Zip, Detention columns; handwritten values are mostly Chinese, location codes (HW, MCE1, TCY2, SCK8, EJS, SSA...) and 5-digit US zips.
Extract EVERY trip row, top to bottom, following the sheet's own order:
- date: the sheet writes month/day (e.g. 10/10) or full dates; output YYYY-MM-DD. Pick the year from the sheet when it shows one, else default to the CURRENT year (today is {TODAY}); if the week range clearly belongs to late December / early January, keep each date in its natural year. A date written once applies to following rows until a new date appears. Skip rows struck through/voided.
- load_no: copy the container number, drop the leading #. Full container numbers (e.g. EGSU8097779) keep as-is.
- from_zip / to_zip: as written; empty string if unreadable.
- nature: the From-To codes as written, e.g. "HW - MCE1".
- operation guess: only use codes from this list: {OPERATIONS}. Picking up / 提货 / 提柜 (hauling a container out of the yard) -> PU; delivering / 卸货 / 还柜 -> DEL; 空车 / 空木柜 / 车架 (no container, chassis only) -> BOBTAIL; 带空柜 (empty container reposition) -> EMPTY. Default DEL.
- note: extra marks like 等卸/detention time ranges (14:30-18:30), 还柜, 提货; empty string if none.
driver_name = the handwritten name in the 司机/Driver header; driver_code = the handwritten 车号 (truck number, e.g. 0608). Use "" when a value is unreadable.`;;

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

function isValidRow(row: OcrTripRow, operations: string[]): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
    typeof row.load_no === "string" &&
    typeof row.from_zip === "string" &&
    typeof row.to_zip === "string" &&
    operations.includes(row.operation)
  );
}

/**
 * Recognize one PU/DEL record photo via the OpenAI vision API
 * (OPENAI_VISION_MODEL, default gpt-4o; OPENAI_BASE_URL for a proxy).
 * operations = the ACTIVE codes from the ops.operation_types dictionary, so
 * the model can only answer with codes the entry form accepts.
 * Throws on any failure so the caller can mark this photo as failed.
 */
export async function recognizeTripPhoto(file: File, operations: string[]): Promise<OcrSheet> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("missing_api_key");

  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type || "image/jpeg"};base64,${buffer.toString("base64")}`;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_VISION_MODEL ?? "gpt-4o";

  const schema = responseSchema(operations);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model,
      response_format: { type: "json_schema", json_schema: { name: schema.name, strict: true, schema } },
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT.replaceAll("{TODAY}", todayIso()).replaceAll("{OPERATIONS}", operations.join(", "))
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            { type: "text", text: "Extract this sheet. Output JSON only." }
          ]
        }
      ]
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`upstream_${res.status}${body.slice(0, 120) ? `: ${body.slice(0, 120)}` : ""}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty_response");

  let parsed: OcrSheet;
  try {
    parsed = JSON.parse(content) as OcrSheet;
  } catch {
    throw new Error("bad_json");
  }
  if (!Array.isArray(parsed.rows)) throw new Error("bad_shape");

  parsed.rows = parsed.rows.filter(row => isValidRow(row, operations));
  parsed.driver_name ??= "";
  parsed.driver_code = String(parsed.driver_code ?? "").trim();
  return parsed;
}
