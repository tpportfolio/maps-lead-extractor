import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#040904",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "999px",
          background: "#000000",
          color: "#7dff8f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 800,
          lineHeight: 1,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        8
      </div>
    </div>,
    { ...size },
  );
}
