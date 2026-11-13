import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { recognizeTripPhoto, type OcrSheet } from "@/lib/vision-ocr";
import { prisma } from "@/lib/prisma";

const MAX_FILES = 21;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

type PhotoResult =
  | { filename: string; ok: true; data: OcrSheet }
  | { filename: string; ok: false; error: string };

function friendlyError(error: string): string {
  if (error === "missing_api_key") return "missing_api_key";
  if (error.startsWith("upstream_")) return "upstream_error";
  return "recognize_failed";
}

/**
 * POST /api/trip-photos (FormData "files"): recognize up to 21 PU/DEL record
 * photos in parallel. Photos are used in-memory only, never stored.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const files = form?.getAll("files").filter((v): v is File => v instanceof File) ?? [];
  if (files.length === 0) return NextResponse.json({ error: "no_files" }, { status: 400 });
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: "too_many_files" }, { status: 400 });
  }
  const oversized = files.find(f => f.size > MAX_FILE_SIZE);
  if (oversized) {
    return NextResponse.json({ error: "file_too_large", filename: oversized.name }, { status: 400 });
  }

  // The model may only answer with ACTIVE codes from the operation dictionary
  const operations = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM ops.operation_types WHERE status = 'ACTIVE' ORDER BY sort_order
  `;
  const operationCodes = operations.map(o => o.code);

  const results = await Promise.all(
    files.map(async (file): Promise<PhotoResult> => {
      try {
        return { filename: file.name, ok: true, data: await recognizeTripPhoto(file, operationCodes) };
      } catch (error) {
        console.error(`trip-photos: ${file.name} failed:`, error instanceof Error ? error.message : error);
        return {
          filename: file.name,
          ok: false,
          error: friendlyError(error instanceof Error ? error.message : String(error))
        };
      }
    })
  );

  return NextResponse.json({ results });
}
