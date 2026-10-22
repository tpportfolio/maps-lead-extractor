import { NextResponse } from "next/server";

// Proxy de thumbnails de Google (lh3.googleusercontent.com) para poder
// embeberlos en el PDF. Sin esto el fetch desde el navegador falla por CORS.

const ALLOWED_HOSTS = [
  "lh3.googleusercontent.com",
  "lh4.googleusercontent.com",
  "lh5.googleusercontent.com",
  "lh6.googleusercontent.com",
  "streetviewpixels-pa.googleapis.com",
  "maps.gstatic.com",
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Falta url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Url invalida" }, { status: 400 });
  }

  // Solo hosts de imagen de Google: evita SSRF contra servicios internos.
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.includes(target.hostname)) {
    return NextResponse.json({ error: "Host no permitido" }, { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "No se pudo obtener" }, { status: 502 });
    }
    const type = upstream.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) {
      return NextResponse.json({ error: "No es imagen" }, { status: 415 });
    }
    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Fallo de red" }, { status: 502 });
  }
}
