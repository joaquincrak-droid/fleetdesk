import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://jfzyueilhrbzkvllyjfd.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impmenl1ZWlsaHJiemt2bGx5amZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgxOTksImV4cCI6MjA5MTg1NDE5OX0.sQms7Rbuv4d3WFQujtkE9KSvg7XBmCNrsp9TJS7Se7k";

const trucks = [
  { id: "T-01", name: "Camión 1", driver: "Miguel" },
  { id: "T-02", name: "Camión 2", driver: "Juan" },
];

const STATUS_CONFIG = {
  pendiente: { label: "Pendiente", color: "#F59E0B", bg: "rgba(245,158,11,0.15)" },
  en_ruta: { label: "En Ruta", color: "#38BDF8", bg: "rgba(56,189,248,0.15)" },
  incidencia: { label: "Incidencia", color: "#F87171", bg: "rgba(248,113,113,0.15)" },
  completado: { label: "Completado", color: "#34D399", bg: "rgba(52,211,153,0.15)" },
};

const TYPE_CONFIG = {
  entrega: { label: "Entrega", icon: "↓", color: "#818CF8" },
  recogida: { label: "Recogida", icon: "↑", color: "#F472B6" },
};

// Datos fijos de la empresa gestora para tareas de RECOGIDA.
// Se rellenan automáticamente al seleccionar tipo = recogida.
const RECOGIDA_DEFAULTS = {
  ler_code: "150103",
  waste_description: "Palets rotos de madera",
  container_type: "Palets de madera rotos",
  destination_gestor: "RECIPALETS TOTANA S.L.",
  destination_cif: "B73384059",
  destination_address: "Autovía del Mediterráneo KM 609",
  destination_nima: "3020143940",
  destination_phone: "637543518",
  destination_email: "medioambiente@jcpalets.com",
};

// ── Supabase helpers ──────────────────────────────────────────
async function sbFetch(path, options = {}, token = null) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token || SUPABASE_KEY}`,
    "Content-Type": "application/json",
    ...options.headers,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function authFetch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Error de autenticación");
  return data;
}

// ── UI helpers ────────────────────────────────────────────────
function Badge({ status }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.pendiente;
  return (
    <span
      style={{
        background: c.bg,
        color: c.color,
        borderRadius: 20,
        padding: "2px 9px",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {c.label}
    </span>
  );
}

function TypeBadge({ type }) {
  const t = TYPE_CONFIG[type] || TYPE_CONFIG.entrega;
  return (
    <span
      style={{
        background: `${t.color}20`,
        color: t.color,
        borderRadius: 20,
        padding: "2px 9px",
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {t.icon} {t.label}
    </span>
  );
}

const inp = {
  width: "100%",
  padding: "13px 14px",
  borderRadius: 12,
  border: "1px solid #1E2D3D",
  background: "#0D1B2A",
  color: "#E2E8F0",
  fontSize: 15,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block",
  fontSize: 11,
  color: "#475569",
  marginBottom: 5,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

// ── Leaflet helpers ───────────────────────────────────────────
function useLeaflet(onReady) {
  useEffect(() => {
    if (window.L) {
      onReady();
      return;
    }
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    script.onload = onReady;
    document.head.appendChild(script);
  }, []);
}

function MiniMap({ lat, lng }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(!!window.L);
  useLeaflet(() => setReady(true));

  useEffect(() => {
    if (!ready || !ref.current) return;
    const L = window.L;
    const map = L.map(ref.current, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      attributionControl: false,
      tap: false,
    }).setView([lat, lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    const icon = L.divIcon({
      html: `<div style="font-size:24px;line-height:1">📍</div>`,
      className: "",
      iconAnchor: [12, 24],
      iconSize: [24, 24],
    });
    L.marker([lat, lng], { icon }).addTo(map);
    return () => map.remove();
  }, [ready, lat, lng]);

  return (
    <div
      style={{
        marginTop: 10,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #1E2D3D",
        position: "relative",
        zIndex: 0,
      }}
    >
      <div ref={ref} style={{ height: 130, width: "100%" }} />
      <button
        onClick={() =>
          window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, "_blank")
        }
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          zIndex: 10,
          background: "#4F46E5",
          border: "none",
          color: "#fff",
          borderRadius: 8,
          padding: "6px 12px",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}
      >
        🚗 Navegar
      </button>
    </div>
  );
}

function MapPicker({ initialAddress, initialLat, initialLng, onConfirm, onClose }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const [leafletReady, setLeafletReady] = useState(!!window.L);
  const [search, setSearch] = useState(initialAddress || "");
  const [searching, setSearching] = useState(false);
  const [pickedAddress, setPickedAddress] = useState(initialAddress || "");
  const [pickedLat, setPickedLat] = useState(initialLat || null);
  const [pickedLng, setPickedLng] = useState(initialLng || null);
  const [searchError, setSearchError] = useState("");
  useLeaflet(() => setLeafletReady(true));

  const placeMarker = (lat, lng, address) => {
    const L = window.L;
    if (!mapInstanceRef.current) return;
    if (markerRef.current) markerRef.current.remove();
    const icon = L.divIcon({
      html: `<div style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">📍</div>`,
      className: "",
      iconAnchor: [16, 32],
      iconSize: [32, 32],
    });
    markerRef.current = L.marker([lat, lng], { icon, draggable: true }).addTo(mapInstanceRef.current);
    markerRef.current.on("dragend", async (e) => {
      const { lat: la, lng: lo } = e.target.getLatLng();
      setPickedLat(la);
      setPickedLng(lo);
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${la}&lon=${lo}&format=json`
        );
        const d = await r.json();
        setPickedAddress(d.display_name || `${la.toFixed(5)}, ${lo.toFixed(5)}`);
        setSearch(d.display_name || `${la.toFixed(5)}, ${lo.toFixed(5)}`);
      } catch {
        setPickedAddress(`${la.toFixed(5)}, ${lo.toFixed(5)}`);
      }
    });
    setPickedLat(lat);
    setPickedLng(lng);
    if (address) {
      setPickedAddress(address);
      setSearch(address);
    }
    mapInstanceRef.current.setView([lat, lng], 16);
  };

  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstanceRef.current) return;
    const L = window.L;
    const map = L.map(mapRef.current, { zoomControl: true }).setView(
      [initialLat || 37.9922, initialLng || -1.1307],
      initialLat ? 16 : 13
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    map.on("click", async (e) => {
      const { lat, lng } = e.latlng;
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
        );
        const d = await r.json();
        placeMarker(lat, lng, d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      } catch {
        placeMarker(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    });
    mapInstanceRef.current = map;
    if (initialLat && initialLng) placeMarker(initialLat, initialLng, initialAddress);
  }, [leafletReady]);

  const handleSearch = async () => {
    if (!search.trim()) return;
    setSearching(true);
    setSearchError("");
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          search
        )}&format=json&limit=1&countrycodes=es`
      );
      const d = await r.json();
      if (!d.length) {
        setSearchError("No encontrado. Prueba con más detalle.");
        setSearching(false);
        return;
      }
      placeMarker(parseFloat(d[0].lat), parseFloat(d[0].lon), d[0].display_name);
    } catch {
      setSearchError("Error de red.");
    }
    setSearching(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(8px)",
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ background: "#0A1628", padding: "14px 14px 10px", borderBottom: "1px solid #1E2D3D" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Busca una dirección..."
            style={{
              flex: 1,
              padding: "11px 14px",
              borderRadius: 10,
              border: "1px solid #1E2D3D",
              background: "#0D1B2A",
              color: "#E2E8F0",
              fontSize: 14,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            style={{
              padding: "11px 16px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg,#4F46E5,#7C3AED)",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {searching ? "..." : "🔍"}
          </button>
        </div>
        {searchError && (
          <div style={{ color: "#F87171", fontSize: 12, marginBottom: 4 }}>{searchError}</div>
        )}
        <div style={{ color: "#475569", fontSize: 11 }}>
          💡 Busca o pulsa en el mapa. Puedes arrastrar la chincheta.
        </div>
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        {!leafletReady && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#475569",
              fontSize: 14,
            }}
          >
            Cargando mapa...
          </div>
        )}
        <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      </div>
      <div style={{ background: "#0A1628", padding: "14px", borderTop: "1px solid #1E2D3D" }}>
        {pickedAddress && (
          <div
            style={{
              color: "#94A3B8",
              fontSize: 12,
              marginBottom: 12,
              padding: "10px 12px",
              background: "#0D1B2A",
              borderRadius: 10,
              border: "1px solid #1E2D3D",
            }}
          >
            📍 {pickedAddress}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: "13px",
              borderRadius: 12,
              border: "1px solid #1E2D3D",
              background: "transparent",
              color: "#64748B",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => pickedLat && onConfirm(pickedAddress, pickedLat, pickedLng)}
            disabled={!pickedLat}
            style={{
              padding: "13px",
              borderRadius: 12,
              border: "none",
              background: pickedLat ? "linear-gradient(135deg,#4F46E5,#7C3AED)" : "#1E2D3D",
              color: pickedLat ? "#fff" : "#475569",
              cursor: pickedLat ? "pointer" : "default",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            ✅ Guardar ubicación
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PDF helpers (jsPDF + DAT) ─────────────────────────────────
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar jsPDF"));
    document.head.appendChild(s);
  });
}

function fmtDate(s) {
  if (!s) return new Date().toLocaleDateString("es-ES");
  try {
    return new Date(s).toLocaleDateString("es-ES");
  } catch {
    return s;
  }
}

// ── DIR (Documento de Identificación de Residuos) ──────────────
// Formato oficial según RD 553/2020, Anexo III. Sin notificación previa.
async function generateDIR(task, settings, truck) {
  await loadJsPdf();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const M = 15;
  const W = 210 - 2 * M;       // ancho útil = 180
  const PAGE_H = 297;

  // ─── Logos ────────────────────────────────────────────────
  // Logo oficial Gobierno de España + MITECO (embebido como PNG base64).
  const GOV_LOGO_B64 = "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";
  // Si tienes el logo de JC PALETS como PNG/JPG, pega aquí el data URL
  // ("data:image/png;base64,...") y se usará en vez del dibujo.
  const JC_LOGO_B64 = "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";

  const drawGovLogo = (x, y) => {
    // 656×147 originales → 55×12 mm conserva proporción
    doc.addImage(GOV_LOGO_B64, "PNG", x, y, 55, 12);
  };

  const drawJcPaletsLogo = (x, y) => {
    // Logo real de JC PALETS (pallet + flechas reciclaje + "JC PALETS"
    // + subtítulo + NIMA embebidos). Proporción ≈ 1.23:1 (ancho:alto).
    const w = 38, h = 31;
    if (JC_LOGO_B64) {
      doc.addImage(JC_LOGO_B64, "PNG", x, y, w, h);
      return;
    }
    // Fallback dibujado (sólo si se borra la constante)
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, w, h, "F");
    doc.setDrawColor(34, 139, 58);
    doc.setLineWidth(1.8);
    doc.triangle(x + 9, y + 1.5, x + 16, y + 9, x + 2, y + 9);
    doc.setLineWidth(0.1);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(232, 108, 30);
    doc.text("JC PALETS", x + 20, y + 8.5);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(6);
    doc.setTextColor(80, 80, 80);
    doc.text("Gestor de residuos no peligrosos", x + 20, y + 13);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    doc.text("NIMA: 3020143940", x + 20, y + 18);
  };

  const drawPageHeader = () => {
    drawGovLogo(M, 14);
    drawJcPaletsLogo(210 - M - 38, 7);
  };

  // ─── Helpers de tabla ─────────────────────────────────────
  const GREY_HEADER = [217, 217, 217];
  const SUB_GREY   = [240, 240, 240];
  const LINE = [0, 0, 0];
  const TXT  = [0, 0, 0];

  const sectionHeader = (y, text) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(text, W - 4);
    const h = Math.max(6, lines.length * 3.6 + 2);
    doc.setFillColor(...GREY_HEADER);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.1);
    doc.rect(M, y, W, h, "FD");
    doc.setTextColor(...TXT);
    lines.forEach((ln, i) =>
      doc.text(ln, M + 2, y + 3.8 + i * 3.6)
    );
    return y + h;
  };

  const subHeader = (y, text) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    const lines = doc.splitTextToSize(text, W - 4);
    const h = Math.max(5, lines.length * 3.2 + 1.8);
    doc.setFillColor(...SUB_GREY);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.1);
    doc.rect(M, y, W, h, "FD");
    doc.setTextColor(...TXT);
    lines.forEach((ln, i) =>
      doc.text(ln, M + 2, y + 3.4 + i * 3.2)
    );
    return y + h;
  };

  // Fila de N celdas. cells = [{label, value, w}]
  const row = (y, cells, h = 6) => {
    let x = M;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.1);
    doc.setTextColor(...TXT);
    cells.forEach((c) => {
      doc.rect(x, y, c.w, h);
      const v = c.value == null ? "" : String(c.value);
      if (c.label) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(c.label, x + 1.5, y + 3);
        const labelW = doc.getTextWidth(c.label);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        const vw = doc.getTextWidth(v);
        // Si etiqueta + valor caben, van en la misma línea
        if (labelW + vw + 4 <= c.w) {
          doc.text(v, x + 1.5 + labelW + 2, y + 3);
        } else {
          // Si no, valor en segunda línea (requiere h ≥ 8)
          const lines = doc.splitTextToSize(v, c.w - 3);
          lines.forEach((ln, i) =>
            doc.text(ln, x + 1.5, Math.min(y + h - 1.5, y + 6.5 + i * 3.2))
          );
        }
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        const lines = doc.splitTextToSize(v, c.w - 3);
        lines.forEach((ln, i) => doc.text(ln, x + 1.5, y + 4 + i * 3.2));
      }
      x += c.w;
    });
    return y + h;
  };

  // ─── Datos pre-rellenados ──────────────────────────────────
  const emisor = settings || {};
  const recipalets = {
    nif: emisor.cif || "B73384059",
    razon: emisor.razon_social || "RECIPALETS TOTANA S.L.",
    nima: emisor.nima || "3020143940",
    inscripcion: emisor.autorizacion || "AAS20250026",
    tipoGestor: "G04",
    direccion: emisor.domicilio || "CALLE NARANJO Nº 6",
    cp: "30850",
    mun: "TOTANA",
    prov: "MURCIA",
    tel: emisor.telefono || "637543518",
    mail: emisor.email || "recipalets@jcpalets.com",
  };

  const opNif  = task.origin_nif || task.origin_cif || "";
  const opName = task.origin_name || task.client || "";
  const opNima = task.origin_nima || "";
  const opInsc = task.origin_nro_inscripcion || "";
  const opTipo = task.origin_tipo_operador || "";
  const opAddr = task.origin_address || task.address || "";
  const opCp   = task.origin_cp || "";
  const opMun  = task.origin_municipio || "";
  const opProv = task.origin_provincia || "";
  const opTel  = task.origin_telefono || "";
  const opMail = task.origin_email || "";

  const shortId  = (task.id || "").toString().slice(0, 8).toUpperCase();
  const diNumber = task.di_number || `${recipalets.nima}/${new Date().getFullYear()}/${shortId}`;

  const halfW = W / 2;          // 90
  const qW    = W / 4;          // 45

  // ══════════ PÁGINA 1 ══════════
  drawPageHeader();
  let y = 42;                   // título empieza BAJO los logos

  // Título
  doc.setTextColor(...TXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.text(
    "DOCUMENTO DE IDENTIFICACIÓN DE RESIDUOS SIN NOTIFICACIÓN PREVIA",
    105, y, { align: "center" }
  );
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(
    "(Artículo 6.1 y Anexo III del R.D. 553/2020, de 2 de junio, por el que se regula el traslado de residuos",
    105, y, { align: "center" }
  );
  y += 3;
  doc.text(
    "en el interior del territorio del Estado. B.O.E. nº 171 del 19/07/2020)",
    105, y, { align: "center" }
  );
  y += 4.5;

  // Documento Nº + Fechas
  y = row(y, [
    { label: "Documento de Identificación  nº ¹", value: diNumber, w: halfW },
    { label: "Fecha inicio de traslado²", value: fmtDate(task.start_date || task.transport_date), w: qW },
    { label: "Fecha fin de traslado²", value: fmtDate(task.end_date || task.transport_date), w: qW },
  ], 8);

  // — OPERADOR DEL TRASLADO —
  y = sectionHeader(y, "INFORMACIÓN RELATIVA AL OPERADOR DEL TRASLADO");
  y = row(y, [
    { label: "NIF", value: opNif, w: halfW },
    { label: "Razón social/Nombre", value: opName, w: halfW },
  ]);
  y = row(y, [
    { label: "NIMA ³", value: opNima, w: halfW / 1.5 },
    { label: "Nº inscripción³", value: opInsc, w: halfW / 1.5 },
    { label: "Tipo Oper. Traslado⁴", value: opTipo, w: W - 2 * (halfW / 1.5) },
  ]);
  y = row(y, [
    { label: "Dirección", value: opAddr, w: W - qW / 2 },
    { label: "C.P.", value: opCp, w: qW / 2 },
  ]);
  y = row(y, [
    { label: "Municipio", value: opMun, w: halfW },
    { label: "Provincia", value: opProv, w: halfW },
  ]);
  y = row(y, [
    { label: "Teléfono", value: opTel, w: halfW },
    { label: "Correo electrónico", value: opMail, w: halfW },
  ]);
  // Firma operador (caja alta)
  y = row(y, [
    { label: "", value: "Firma operador de traslado", w: qW },
    { label: "", value: "", w: W - qW },
  ], 12);

  // — ORIGEN DEL TRASLADO —
  y = sectionHeader(y, "INFORMACIÓN RELATIVA AL ORIGEN DEL TRASLADO");
  y = subHeader(y, "Información del centro productor o poseedor de residuos o de la instalación origen del traslado:");
  y = row(y, [
    { label: "NIF ⁵", value: opNif, w: halfW },
    { label: "Razón social/Nombre", value: opName, w: halfW },
  ]);
  y = row(y, [
    { label: "NIMA ³", value: opNima, w: halfW / 1.5 },
    { label: "Nº inscripción ³", value: opInsc, w: halfW / 1.5 },
    { label: "Tipo centro Productor⁶", value: opTipo, w: W - 2 * (halfW / 1.5) },
  ]);
  y = row(y, [
    { label: "Dirección⁷", value: opAddr, w: W - qW / 2 },
    { label: "C.P.", value: opCp, w: qW / 2 },
  ]);
  y = row(y, [
    { label: "Municipio", value: opMun, w: halfW },
    { label: "Provincia", value: opProv, w: halfW },
  ]);
  y = row(y, [
    { label: "Teléfono", value: opTel, w: halfW },
    { label: "Correo electrónico", value: opMail, w: halfW },
  ]);
  y = subHeader(
    y,
    "Información de la empresa autorizada para realizar operaciones de tratamiento de residuos, incluido el almacenamiento, en caso de que el origen del traslado sea una instalación de tratamiento de residuos:"
  );
  y = row(y, [{ label: "NIF", value: "", w: halfW }, { label: "Razón social/Nombre", value: "", w: halfW }]);
  y = row(y, [{ label: "NIMA", value: "", w: halfW }, { label: "Nº inscripción", value: "", w: halfW }]);
  y = row(y, [{ label: "Dirección", value: "", w: W - qW / 2 }, { label: "C.P.", value: "", w: qW / 2 }]);
  y = row(y, [{ label: "Municipio", value: "", w: halfW }, { label: "Provincia", value: "", w: halfW }]);
  y = row(y, [{ label: "Teléfono", value: "", w: halfW }, { label: "Correo electrónico", value: "", w: halfW }]);

  // — DESTINO DEL TRASLADO (RECIPALETS) —
  y = sectionHeader(y, "INFORMACIÓN RELATIVA AL DESTINO DEL TRASLADO");
  y = subHeader(y, "Información de la instalación de destino¹⁵:");
  y = row(y, [
    { label: "NIF", value: recipalets.nif, w: halfW },
    { label: "Razón social/Nombre", value: recipalets.razon, w: halfW },
  ]);
  y = row(y, [
    { label: "NIMA", value: recipalets.nima, w: halfW / 1.5 },
    { label: "Nº inscripción", value: recipalets.inscripcion, w: halfW / 1.5 },
    { label: "Tipo centro gestor⁸", value: recipalets.tipoGestor, w: W - 2 * (halfW / 1.5) },
  ]);
  y = row(y, [
    { label: "Dirección", value: recipalets.direccion, w: W - qW / 2 },
    { label: "C.P.", value: recipalets.cp, w: qW / 2 },
  ]);
  y = row(y, [
    { label: "Municipio", value: recipalets.mun, w: halfW },
    { label: "Provincia", value: recipalets.prov, w: halfW },
  ]);
  y = row(y, [
    { label: "Teléfono", value: recipalets.tel, w: halfW },
    { label: "Correo electrónico", value: recipalets.mail, w: halfW },
  ]);
  y = subHeader(
    y,
    "Información de la empresa autorizada para realizar operaciones de tratamiento de residuos, incluido el almacenamiento, en la instalación de destino:"
  );
  y = row(y, [
    { label: "NIF", value: recipalets.nif, w: halfW },
    { label: "Razón social/Nombre", value: recipalets.razon, w: halfW },
  ]);
  y = row(y, [
    { label: "NIMA", value: recipalets.nima, w: halfW },
    { label: "Nº inscripción", value: recipalets.inscripcion, w: halfW },
  ]);
  y = row(y, [
    { label: "Dirección", value: recipalets.direccion, w: W - qW / 2 },
    { label: "C.P.", value: recipalets.cp, w: qW / 2 },
  ]);
  y = row(y, [
    { label: "Municipio", value: recipalets.mun, w: halfW },
    { label: "Provincia", value: recipalets.prov, w: halfW },
  ]);
  y = row(y, [
    { label: "Teléfono", value: recipalets.tel, w: halfW },
    { label: "Correo electrónico", value: recipalets.mail, w: halfW },
  ]);

  // ══════════ PÁGINA 2 ══════════
  doc.addPage();
  drawPageHeader();
  y = 42;

  // — RESIDUO QUE SE TRASLADA —
  y = sectionHeader(y, "INFORMACIÓN SOBRE EL RESIDUO QUE SE TRASLADA");
  y = row(y, [
    { label: "Código LER/LER-extendido⁹", value: task.ler_code || "", w: halfW },
    { label: "", value: task.ler_code || "", w: halfW },
  ]);
  y = row(y, [
    { label: "Descripción del residuo:", value: task.waste_description || "", w: W },
  ]);
  // Operación R: etiqueta larga, valor en línea separada
  y = row(y, [
    { label: "Operación de tratamiento destino (código R)¹⁰", value: "R1201", w: halfW },
    { label: "Código tratamiento destino desagregado (4 cifras)¹¹", value: "R1201", w: halfW },
  ], 10);
  y = row(y, [
    { label: "Descripción operación tratamiento¹²", value: "Clasificación de residuos", w: W },
  ]);
  y = row(y, [{ label: "Cantidad (kg netos)", value: task.quantity || task.weight || "", w: W }]);

  // — RESPONSABILIDAD AMPLIADA —
  y = sectionHeader(
    y,
    "INFORMACIÓN DEL SISTEMA DE RESPONSABILIDAD AMPLIADA DEL PRODUCTOR QUE, EN SU CASO, DECIDE LA INSTALACIÓN"
  );
  y = row(y, [{ label: "NIF", value: "", w: halfW }, { label: "Razón social/Nombre", value: "", w: halfW }]);
  y = row(y, [{ label: "NIMA", value: "", w: halfW }, { label: "Nº inscripción", value: "", w: halfW }]);
  y = row(y, [{ label: "Dirección", value: "", w: W - qW / 2 }, { label: "C.P.", value: "", w: qW / 2 }]);
  y = row(y, [{ label: "Municipio", value: "", w: halfW }, { label: "Provincia", value: "", w: halfW }]);
  y = row(y, [{ label: "Teléfono", value: "", w: halfW }, { label: "Correo electrónico", value: "", w: halfW }]);

  // — TRANSPORTISTA (RECIPALETS) —
  y = sectionHeader(y, "INFORMACIÓN RELATIVA AL TRANSPORTISTA");
  y = row(y, [
    { label: "N.I.F.:", value: recipalets.nif, w: halfW },
    { label: "Razón social/Nombre y apellidos", value: recipalets.razon, w: halfW },
  ]);
  y = row(y, [
    { label: "NIMA:", value: recipalets.nima, w: halfW },
    { label: "Nº inscripción", value: recipalets.inscripcion, w: halfW },
  ]);
  y = row(y, [
    { label: "Dirección", value: recipalets.direccion, w: W - qW / 2 },
    { label: "C.P.", value: recipalets.cp, w: qW / 2 },
  ]);
  y = row(y, [
    { label: "Municipio", value: recipalets.mun, w: halfW },
    { label: "Provincia", value: recipalets.prov, w: halfW },
  ]);
  y = row(y, [
    { label: "Teléfono", value: recipalets.tel, w: halfW },
    { label: "Correo electrónico", value: recipalets.mail, w: halfW },
  ]);

  // — ACEPTACIÓN DEL RESIDUO —
  // Se prerrellena como si la mercancía hubiera sido aceptada el mismo día
  // de la recogida (estándar RECIPALETS): fecha de entrega, fecha de
  // aceptación = fecha de la recogida y casilla "Sí" marcada.
  const fechaRecogida = fmtDate(task.transport_date || task.start_date || task.end_date);
  const kgsAceptados = task.quantity || task.weight || "";
  y = sectionHeader(y, "INFORMACIÓN SOBRE LA ACEPTACIÓN DEL RESIDUO");
  y = row(y, [
    { label: "Fecha entrega:", value: fechaRecogida, w: halfW },
    { label: "Kg. netos recibidos", value: kgsAceptados, w: qW },
    { label: "Aceptación", value: "Sí [X]   No [ ]", w: qW },
  ]);
  y = row(y, [{ label: "Fecha aceptación/rechazo", value: fechaRecogida, w: W }]);
  y = row(y, [{ label: "Acción en caso de rechazo", value: "", w: W }]);
  y = row(y, [{ label: "Fecha devolución/reenvío", value: "", w: W }]);
  y = row(y, [{ label: "Motivo de rechazo", value: "", w: W }]);

  // Helper: dibuja el sello RECIPALETS centrado en una caja
  const drawRecipaletsSello = (boxX, boxY, boxW, boxH) => {
    const cx = boxX + boxW / 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(25, 55, 155);
    doc.text("RECIPALETS TOTANA S.L.", cx, boxY + 5, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("C.I.F.: B-73384059", cx, boxY + 8, { align: "center" });
    doc.text("Autovía del Mediterráneo Km 609", cx, boxY + 11, { align: "center" });
    doc.text("30850 TOTANA (Murcia)", cx, boxY + 14, { align: "center" });
    doc.text("Tlf. +34 637 54 35 18", cx, boxY + 17, { align: "center" });
    doc.setTextColor(...TXT);
  };

  // Firma del gestor de destino: RECEPCIÓN (con sello RECIPALETS)
  const firmaH = 18;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.1);
  doc.rect(M, y, qW, firmaH);
  doc.rect(M + qW, y, W - qW, firmaH);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("Firma del gestor de la", M + 1.5, y + 4);
  doc.text("instalación de destino", M + 1.5, y + 7);
  doc.text("recepción del residuo¹³", M + 1.5, y + 10);
  drawRecipaletsSello(M + qW, y, W - qW, firmaH);
  y += firmaH;

  // Firma del gestor de destino: ACEPTACIÓN/RECHAZO (también con sello)
  doc.rect(M, y, qW, firmaH);
  doc.rect(M + qW, y, W - qW, firmaH);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("Firma del gestor de la", M + 1.5, y + 4);
  doc.text("instalación de destino", M + 1.5, y + 7);
  doc.text("aceptación/rechazo", M + 1.5, y + 10);
  doc.text("residuo¹⁴", M + 1.5, y + 13);
  drawRecipaletsSello(M + qW, y, W - qW, firmaH);
  y += firmaH;

  // — RECEPCIÓN EN ORIGEN DEL RESIDUO RECHAZADO —
  y = sectionHeader(y, "INFORMACIÓN SOBRE LA RECEPCIÓN EN ORIGEN DEL RESIDUO RECHAZADO Y DEVUELTO");
  y = row(y, [
    { label: "Fecha entrega:", value: "", w: halfW },
    { label: "Kg. netos recibidos", value: "", w: halfW },
  ]);

  // Pie
  doc.setFontSize(6.5);
  doc.setTextColor(120, 120, 120);
  doc.text(
    "DIR generado con FleetDesk · Conserve una copia durante el transporte.",
    M, PAGE_H - 6
  );

  // Guardar
  const cliente = (task.origin_name || task.client || "cliente")
    .toString()
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase()
    .slice(0, 24);
  const fname = `DIR_${diNumber.replace(/\//g, "-")}_${cliente}.pdf`;
  doc.save(fname);
}

// Alias por compatibilidad con llamadas antiguas
const generateDAT = generateDIR;

// ── Login Screen ──────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!email || !password) {
      setError("Introduce email y contraseña");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await authFetch("token?grant_type=password", { email, password });
      onLogin(data.access_token, data.user, data.refresh_token);
    } catch (e) {
      setError("Email o contraseña incorrectos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#060D1A",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "linear-gradient(135deg,#4F46E5,#7C3AED)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              margin: "0 auto 16px",
            }}
          >
            🚛
          </div>
          <div style={{ fontWeight: 800, fontSize: 26, color: "#F1F5F9" }}>FleetDesk</div>
          <div style={{ color: "#475569", fontSize: 14, marginTop: 4 }}>
            Gestión de rutas y entregas
          </div>
        </div>
        <div
          style={{
            background: "#0A1628",
            border: "1px solid #1E2D3D",
            borderRadius: 20,
            padding: "28px 24px",
          }}
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                style={inp}
                placeholder="tu@email.com"
              />
            </div>
            <div>
              <label style={labelStyle}>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                style={inp}
                placeholder="••••••••"
              />
            </div>
          </div>
          {error && (
            <div style={{ marginTop: 12, color: "#F87171", fontSize: 13, textAlign: "center" }}>
              {error}
            </div>
          )}
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              width: "100%",
              marginTop: 20,
              padding: "15px",
              borderRadius: 12,
              border: "none",
              background: loading ? "#1E2D3D" : "linear-gradient(135deg,#4F46E5,#7C3AED)",
              color: loading ? "#475569" : "#fff",
              cursor: loading ? "default" : "pointer",
              fontWeight: 700,
              fontSize: 16,
              fontFamily: "inherit",
            }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task Modal ────────────────────────────────────────────────
function TaskModal({ task, onClose, onSave, loading, isAdmin, userTruck = null, operators = [], onSaveOperator, onNextDi }) {
  const [form, setForm] = useState(
    task || {
      // Los conductores sólo pueden crear recogidas en su propio camión.
      type: isAdmin ? "entrega" : "recogida",
      truck: isAdmin ? "T-01" : (userTruck || "T-01"),
      client: "",
      address: "",
      lat: null,
      lng: null,
      time: "",
      status: "pendiente",
      weight: "",
      notes: "",
      // DAT
      ler_code: "",
      waste_description: "",
      quantity: "",
      container_type: "",
      origin_name: "",
      origin_address: "",
      origin_cif: "",
      origin_nif: "",
      origin_nima: "",
      origin_nro_inscripcion: "",
      origin_tipo_operador: "",
      origin_cp: "",
      origin_municipio: "",
      origin_provincia: "",
      origin_telefono: "",
      origin_email: "",
      destination_gestor: "",
      destination_nima: "",
      transport_date: "",
      di_number: "",
      start_date: "",
      end_date: "",
    }
  );
  const [showMap, setShowMap] = useState(false);
  const [showOperator, setShowOperator] = useState(false);
  const [operatorQuery, setOperatorQuery] = useState(form.origin_name || "");
  const [showSuggest, setShowSuggest] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Aplica los datos de un operador seleccionado al formulario (origen + operador)
  const applyOperator = (op) => {
    setForm((f) => ({
      ...f,
      origin_name: op.razon_social || "",
      origin_nif: op.cif || "",
      origin_cif: op.cif || "",
      origin_nima: op.nima || "",
      origin_nro_inscripcion: op.nro_inscripcion || "",
      origin_tipo_operador: op.tipo_operador || "",
      origin_address: op.direccion || "",
      origin_cp: op.cp || "",
      origin_municipio: op.municipio || "",
      origin_provincia: op.provincia || "",
      origin_telefono: op.telefono || "",
      origin_email: op.email || "",
    }));
    setOperatorQuery(op.razon_social || "");
    setShowSuggest(false);
  };

  // Autocompletar DAT cuando el tipo es "recogida".
  // Solo rellena campos vacíos (no pisa lo que el usuario haya escrito).
  useEffect(() => {
    if (form.type !== "recogida") return;
    setForm((f) => {
      const today = new Date().toISOString().slice(0, 10);
      const next = { ...f };
      let touched = false;
      for (const [k, v] of Object.entries(RECOGIDA_DEFAULTS)) {
        if (!next[k]) { next[k] = v; touched = true; }
      }
      if (!next.transport_date) { next.transport_date = today; touched = true; }
      if (!next.start_date) { next.start_date = today; touched = true; }
      if (!next.end_date) { next.end_date = today; touched = true; }
      return touched ? next : f;
    });
  }, [form.type]);

  // Genera Nº DI en vivo cuando cambia el NIMA (o NIF) del operador del traslado.
  // Lo ve el chófer en el campo al instante, con formato NIMA/AAAA/NNNNNNN.
  useEffect(() => {
    if (form.type !== "recogida") return;
    const nima = form.origin_nima || form.origin_nif;
    if (!nima) return;
    const year = new Date().getFullYear();
    const expectedPrefix = `${nima}/${year}/`;
    const cur = form.di_number || "";
    const ok = cur.startsWith(expectedPrefix) && /\/\d{7}$/.test(cur);
    if (ok) return;
    let cancelled = false;
    (async () => {
      if (typeof onNextDi !== "function") return;
      const di = await onNextDi(nima);
      if (!cancelled && di) setForm((f) => ({ ...f, di_number: di }));
    })();
    return () => { cancelled = true; };
  }, [form.type, form.origin_nima, form.origin_nif]);

  const suggestions = (() => {
    const q = (operatorQuery || "").trim().toLowerCase();
    if (!q) return [];
    return (operators || [])
      .filter((o) => (o.razon_social || "").toLowerCase().includes(q))
      .slice(0, 6);
  })();

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(8px)",
          zIndex: 100,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
        }}
        onClick={onClose}
      >
        <div
          style={{
            background: "#0A1628",
            border: "1px solid #1E2D3D",
            borderRadius: "20px 20px 0 0",
            padding: "20px 16px 36px",
            width: "100%",
            maxWidth: 540,
            boxShadow: "0 -20px 60px rgba(0,0,0,0.6)",
            maxHeight: "92vh",
            overflowY: "auto",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              width: 36,
              height: 4,
              background: "#1E2D3D",
              borderRadius: 99,
              margin: "0 auto 18px",
            }}
          />
          <h3 style={{ margin: "0 0 18px", fontSize: 17, fontWeight: 700, color: "#E2E8F0" }}>
            {task ? "Editar tarea" : "Nueva tarea"}
          </h3>
          <div style={{ display: "grid", gap: 12 }}>
            {isAdmin && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelStyle}>Tipo</label>
                  <select value={form.type} onChange={(e) => set("type", e.target.value)} style={inp}>
                    <option value="entrega">↓ Entrega</option>
                    <option value="recogida">↑ Recogida</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Conductor</label>
                  <select
                    value={form.truck}
                    onChange={(e) => set("truck", e.target.value)}
                    style={inp}
                  >
                    {trucks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.driver}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {form.type !== "recogida" && (<>
            <div>
              <label style={labelStyle}>Cliente</label>
              <input
                value={form.client}
                onChange={(e) => set("client", e.target.value)}
                style={inp}
                placeholder="Nombre del cliente"
              />
            </div>
            <div>
              <label style={labelStyle}>Ubicación</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={form.address}
                  style={{ ...inp, flex: 1 }}
                  placeholder="Busca en el mapa →"
                  readOnly
                />
                <button
                  type="button"
                  onClick={() => setShowMap(true)}
                  style={{
                    width: 50,
                    borderRadius: 10,
                    border: form.lat ? "2px solid #4F46E5" : "1px solid #1E2D3D",
                    background: form.lat ? "rgba(79,70,229,0.15)" : "#0D1B2A",
                    cursor: "pointer",
                    fontSize: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  📍
                </button>
              </div>
              {form.lat && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#4F46E5" }}>
                  ✓ Ubicación guardada en el mapa
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Hora</label>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => set("time", e.target.value)}
                  style={inp}
                />
              </div>
              <div>
                <label style={labelStyle}>Peso</label>
                <input
                  value={form.weight}
                  onChange={(e) => set("weight", e.target.value)}
                  style={inp}
                  placeholder="ej. 200 kg"
                />
              </div>
            </div>
            {isAdmin && (
              <div>
                <label style={labelStyle}>Estado</label>
                <select
                  value={form.status}
                  onChange={(e) => set("status", e.target.value)}
                  style={inp}
                >
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Notas</label>
              <input
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                style={inp}
                placeholder="Instrucciones especiales..."
              />
            </div>
            </>)}

            {/* Datos DAT (Documento que Acompaña al Transporte) — solo en RECOGIDA */}
            {form.type === "recogida" && (
              <div style={{ display: "grid", gap: 10, padding: "4px 2px 2px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Código LER</label>
                    <input
                      value={form.ler_code}
                      onChange={(e) => set("ler_code", e.target.value)}
                      style={inp}
                      placeholder="ej. 20 03 01"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Cantidad</label>
                    <input
                      value={form.quantity}
                      onChange={(e) => set("quantity", e.target.value)}
                      style={inp}
                      placeholder="ej. 250 kg"
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Descripción del residuo</label>
                  <input
                    value={form.waste_description}
                    onChange={(e) => set("waste_description", e.target.value)}
                    style={inp}
                    placeholder="ej. Residuos mezclados de construcción"
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Tipo envase</label>
                    <input
                      value={form.container_type}
                      onChange={(e) => set("container_type", e.target.value)}
                      style={inp}
                      placeholder="ej. Contenedor 5 m³"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha transporte</label>
                    <input
                      type="date"
                      value={form.transport_date || ""}
                      onChange={(e) => set("transport_date", e.target.value)}
                      style={inp}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "#475569", fontWeight: 600 }}>
                  OPERADOR / ORIGEN (productor del residuo)
                </div>
                <div style={{ position: "relative" }}>
                  <label style={labelStyle}>Nombre / Razón social</label>
                  <input
                    value={operatorQuery}
                    onChange={(e) => {
                      setOperatorQuery(e.target.value);
                      set("origin_name", e.target.value);
                      setShowSuggest(true);
                    }}
                    onFocus={() => setShowSuggest(true)}
                    onBlur={() => setTimeout(() => setShowSuggest(false), 180)}
                    style={inp}
                    placeholder="Escribe para buscar empresa…"
                    autoComplete="off"
                  />
                  {showSuggest && suggestions.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        background: "#0F1E33",
                        border: "1px solid #1E2D3D",
                        borderRadius: 10,
                        marginTop: 4,
                        maxHeight: 200,
                        overflowY: "auto",
                        zIndex: 10,
                      }}
                    >
                      {suggestions.map((op) => (
                        <div
                          key={op.id}
                          onMouseDown={(e) => { e.preventDefault(); applyOperator(op); }}
                          style={{
                            padding: "10px 12px",
                            cursor: "pointer",
                            borderBottom: "1px solid #1E2D3D",
                            color: "#E2E8F0",
                            fontSize: 13,
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>{op.razon_social}</div>
                          <div style={{ fontSize: 11, color: "#64748B" }}>
                            {[op.cif, op.nima, op.municipio].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => setShowOperator(true)}
                    style={{
                      background: "transparent",
                      border: "1px solid #1E2D3D",
                      color: "#818CF8",
                      padding: "6px 10px",
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    + Nuevo operador
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={labelStyle}>NIF / CIF</label>
                    <input
                      value={form.origin_nif || form.origin_cif || ""}
                      onChange={(e) => { set("origin_nif", e.target.value); set("origin_cif", e.target.value); }}
                      style={inp}
                      placeholder="B12345678"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>NIMA</label>
                    <input
                      value={form.origin_nima || ""}
                      onChange={(e) => set("origin_nima", e.target.value)}
                      style={inp}
                      placeholder="NIMA del operador"
                    />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Nº inscripción</label>
                    <input
                      value={form.origin_nro_inscripcion || ""}
                      onChange={(e) => set("origin_nro_inscripcion", e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Tipo operador</label>
                    <input
                      value={form.origin_tipo_operador || ""}
                      onChange={(e) => set("origin_tipo_operador", e.target.value)}
                      style={inp}
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Dirección</label>
                  <input
                    value={form.origin_address}
                    onChange={(e) => set("origin_address", e.target.value)}
                    style={inp}
                    placeholder="Dirección del origen"
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 2fr", gap: 10 }}>
                  <div>
                    <label style={labelStyle}>C.P.</label>
                    <input
                      value={form.origin_cp || ""}
                      onChange={(e) => set("origin_cp", e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Municipio</label>
                    <input
                      value={form.origin_municipio || ""}
                      onChange={(e) => set("origin_municipio", e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Provincia</label>
                    <input
                      value={form.origin_provincia || ""}
                      onChange={(e) => set("origin_provincia", e.target.value)}
                      style={inp}
                    />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Teléfono</label>
                    <input
                      value={form.origin_telefono || ""}
                      onChange={(e) => set("origin_telefono", e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input
                      value={form.origin_email || ""}
                      onChange={(e) => set("origin_email", e.target.value)}
                      style={inp}
                    />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Fecha inicio</label>
                    <input
                      type="date"
                      value={form.start_date || ""}
                      onChange={(e) => set("start_date", e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha fin</label>
                    <input
                      type="date"
                      value={form.end_date || ""}
                      onChange={(e) => set("end_date", e.target.value)}
                      style={inp}
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Nº documento (DI)</label>
                  <input
                    value={form.di_number || ""}
                    onChange={(e) => set("di_number", e.target.value)}
                    style={inp}
                    placeholder="Se genera automáticamente al guardar"
                  />
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "#475569", fontWeight: 600 }}>
                  GESTOR DESTINO
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Nombre gestor</label>
                    <input
                      value={form.destination_gestor}
                      onChange={(e) => set("destination_gestor", e.target.value)}
                      style={inp}
                      placeholder="Planta / gestor autorizado"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>NIMA</label>
                    <input
                      value={form.destination_nima}
                      onChange={(e) => set("destination_nima", e.target.value)}
                      style={inp}
                      placeholder="NIMA gestor"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 18 }}>
            <button
              onClick={onClose}
              style={{
                padding: "14px",
                borderRadius: 12,
                border: "1px solid #1E2D3D",
                background: "transparent",
                color: "#64748B",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={() => onSave(form)}
              disabled={loading}
              style={{
                padding: "14px",
                borderRadius: 12,
                border: "none",
                background: loading ? "#1E2D3D" : "linear-gradient(135deg,#4F46E5,#7C3AED)",
                color: loading ? "#475569" : "#fff",
                cursor: loading ? "default" : "pointer",
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              {loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
      {showMap && (
        <MapPicker
          initialAddress={form.address}
          initialLat={form.lat}
          initialLng={form.lng}
          onConfirm={(address, lat, lng) => {
            setForm((f) => ({ ...f, address, lat, lng }));
            setShowMap(false);
          }}
          onClose={() => setShowMap(false)}
        />
      )}
      {showOperator && (
        <OperatorModal
          onClose={() => setShowOperator(false)}
          onSave={async (op) => {
            try {
              await onSaveOperator(op);
              applyOperator(op);
              setShowOperator(false);
            } catch (e) {
              alert("Error al guardar operador: " + (e.message || e));
            }
          }}
          initialName={operatorQuery}
        />
      )}
    </>
  );
}

// ── Operator Modal (alta rápida) ─────────────────────────────
function OperatorModal({ onClose, onSave, initialName }) {
  const [op, setOp] = useState({
    razon_social: initialName || "",
    cif: "",
    nima: "",
    nro_inscripcion: "",
    tipo_operador: "",
    direccion: "",
    cp: "",
    municipio: "",
    provincia: "",
    telefono: "",
    email: "",
  });
  const set = (k, v) => setOp((o) => ({ ...o, [k]: v }));
  const inp = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #1E2D3D",
    background: "#0F1E33",
    color: "#E2E8F0",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 11, color: "#64748B", fontWeight: 600, marginBottom: 4, display: "block" };
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
        backdropFilter: "blur(8px)", zIndex: 200, display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0A1628", border: "1px solid #1E2D3D", borderRadius: 16,
          padding: 20, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "#E2E8F0", marginBottom: 14 }}>
          Nuevo operador
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label style={labelStyle}>Razón social *</label>
            <input value={op.razon_social} onChange={(e) => set("razon_social", e.target.value)} style={inp} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>CIF / NIF</label>
              <input value={op.cif} onChange={(e) => set("cif", e.target.value)} style={inp} />
            </div>
            <div>
              <label style={labelStyle}>NIMA</label>
              <input value={op.nima} onChange={(e) => set("nima", e.target.value)} style={inp} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Nº inscripción</label>
              <input value={op.nro_inscripcion} onChange={(e) => set("nro_inscripcion", e.target.value)} style={inp} />
            </div>
            <div>
              <label style={labelStyle}>Tipo operador</label>
              <input value={op.tipo_operador} onChange={(e) => set("tipo_operador", e.target.value)} style={inp} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Dirección</label>
            <input value={op.direccion} onChange={(e) => set("direccion", e.target.value)} style={inp} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 2fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>C.P.</label>
              <input value={op.cp} onChange={(e) => set("cp", e.target.value)} style={inp} />
            </div>
            <div>
              <label style={labelStyle}>Municipio</label>
              <input value={op.municipio} onChange={(e) => set("municipio", e.target.value)} style={inp} />
            </div>
            <div>
              <label style={labelStyle}>Provincia</label>
              <input value={op.provincia} onChange={(e) => set("provincia", e.target.value)} style={inp} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Teléfono</label>
              <input value={op.telefono} onChange={(e) => set("telefono", e.target.value)} style={inp} />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input value={op.email} onChange={(e) => set("email", e.target.value)} style={inp} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 16px", borderRadius: 10, border: "1px solid #1E2D3D",
              background: "transparent", color: "#64748B", cursor: "pointer",
              fontWeight: 600, fontSize: 13,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => { if (!op.razon_social) return alert("Razón social obligatoria"); onSave(op); }}
            style={{
              padding: "10px 16px", borderRadius: 10, border: "none",
              background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "#fff",
              cursor: "pointer", fontWeight: 700, fontSize: 13,
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({ onConfirm, onCancel, loading }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "#0A1628",
          border: "1px solid #1E2D3D",
          borderRadius: "20px 20px 0 0",
          padding: "24px 20px 36px",
          width: "100%",
          maxWidth: 540,
          textAlign: "center",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 36,
            height: 4,
            background: "#1E2D3D",
            borderRadius: 99,
            margin: "0 auto 20px",
          }}
        />
        <div style={{ fontSize: 36, marginBottom: 10 }}>🗑️</div>
        <div style={{ fontWeight: 700, fontSize: 17, color: "#E2E8F0", marginBottom: 6 }}>
          ¿Eliminar tarea?
        </div>
        <div style={{ color: "#475569", fontSize: 13, marginBottom: 24 }}>No se puede deshacer</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "14px",
              borderRadius: 12,
              border: "1px solid #1E2D3D",
              background: "transparent",
              color: "#64748B",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: "14px",
              borderRadius: 12,
              border: "none",
              background: "#EF4444",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {loading ? "..." : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Settings Screen ───────────────────────────────────────────
function SettingsScreen({ settings, onSave, saving, onBack, isAdmin }) {
  const [form, setForm] = useState({
    razon_social: settings?.razon_social || "",
    cif: settings?.cif || "",
    domicilio: settings?.domicilio || "",
    telefono: settings?.telefono || "",
    email: settings?.email || "",
    nima: settings?.nima || "",
    autorizacion: settings?.autorizacion || "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ padding: "16px", maxWidth: 640, margin: "0 auto" }}>
      <h2 style={{ margin: "4px 0 14px", fontSize: 18, fontWeight: 800, color: "#F1F5F9" }}>
        Ajustes de la empresa
      </h2>
      <p style={{ color: "#64748B", fontSize: 13, marginTop: 0 }}>
        Estos datos aparecerán en los Documentos de Acompañamiento del Transporte (DAT) que
        generes desde cada tarea.
      </p>

      <div
        style={{
          background: "#0A1628",
          border: "1px solid #1E2D3D",
          borderRadius: 16,
          padding: "18px 16px",
          display: "grid",
          gap: 12,
          marginTop: 14,
        }}
      >
        <div>
          <label style={labelStyle}>Razón social</label>
          <input
            value={form.razon_social}
            onChange={(e) => set("razon_social", e.target.value)}
            style={inp}
            placeholder="Transportes XYZ S.L."
            disabled={!isAdmin}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>CIF / NIF</label>
            <input
              value={form.cif}
              onChange={(e) => set("cif", e.target.value)}
              style={inp}
              placeholder="B12345678"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label style={labelStyle}>Teléfono</label>
            <input
              value={form.telefono}
              onChange={(e) => set("telefono", e.target.value)}
              style={inp}
              placeholder="+34 600 000 000"
              disabled={!isAdmin}
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Domicilio</label>
          <input
            value={form.domicilio}
            onChange={(e) => set("domicilio", e.target.value)}
            style={inp}
            placeholder="Calle, número, CP, localidad, provincia"
            disabled={!isAdmin}
          />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            style={inp}
            placeholder="contacto@empresa.com"
            disabled={!isAdmin}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>NIMA</label>
            <input
              value={form.nima}
              onChange={(e) => set("nima", e.target.value)}
              style={inp}
              placeholder="Opcional"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label style={labelStyle}>Nº autorización transportista</label>
            <input
              value={form.autorizacion}
              onChange={(e) => set("autorizacion", e.target.value)}
              style={inp}
              placeholder="T-000XXX"
              disabled={!isAdmin}
            />
          </div>
        </div>

        {isAdmin && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 8 }}>
            <button
              onClick={onBack}
              style={{
                padding: "13px",
                borderRadius: 12,
                border: "1px solid #1E2D3D",
                background: "transparent",
                color: "#64748B",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                fontFamily: "inherit",
              }}
            >
              Volver
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "13px",
                borderRadius: 12,
                border: "none",
                background: saving
                  ? "#1E2D3D"
                  : saved
                  ? "#10B981"
                  : "linear-gradient(135deg,#4F46E5,#7C3AED)",
                color: saving ? "#475569" : "#fff",
                cursor: saving ? "default" : "pointer",
                fontWeight: 700,
                fontSize: 14,
                fontFamily: "inherit",
              }}
            >
              {saving ? "Guardando..." : saved ? "✓ Guardado" : "Guardar ajustes"}
            </button>
          </div>
        )}
        {!isAdmin && (
          <div style={{ color: "#64748B", fontSize: 12, fontStyle: "italic" }}>
            Solo el administrador puede editar estos datos.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [truckId, setTruckId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [activeTab, setActiveTab] = useState("activas");
  const [filterTruck, setFilterTruck] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState("recientes"); // recientes | hora | cliente
  const [view, setView] = useState("tareas"); // tareas | ajustes
  const [settings, setSettings] = useState(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [operators, setOperators] = useState([]);

  useEffect(() => {
    const link = document.createElement("link");
    link.href =
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);

    // Restore session (persistente entre cierres de navegador).
    // Si hay refresh_token, lo canjeamos por un access_token fresco
    // para evitar 401 cuando el anterior ha caducado (duran ~1 h).
    const savedToken = localStorage.getItem("fleet_token");
    const savedUser = localStorage.getItem("fleet_user");
    const savedRole = localStorage.getItem("fleet_role");
    const savedTruck = localStorage.getItem("fleet_truck");
    const savedRefresh = localStorage.getItem("fleet_refresh");
    if (savedToken && savedUser && savedRole) {
      const userObj = JSON.parse(savedUser);
      setUser(userObj);
      setRole(savedRole);
      if (savedTruck && savedTruck !== "null") setTruckId(savedTruck);
      if (savedRefresh) {
        // Refrescar el token antes de usarlo
        authFetch("token?grant_type=refresh_token", { refresh_token: savedRefresh })
          .then((data) => {
            setToken(data.access_token);
            localStorage.setItem("fleet_token", data.access_token);
            if (data.refresh_token) {
              localStorage.setItem("fleet_refresh", data.refresh_token);
            }
          })
          .catch(() => {
            // Refresh falló (token revocado, expirado, etc.) → forzar re-login
            localStorage.clear();
            setUser(null);
            setRole(null);
            setTruckId(null);
          });
      } else {
        // Sesión antigua sin refresh_token: se usa lo que haya hasta que expire
        setToken(savedToken);
      }
    }
  }, []);

  useEffect(() => {
    if (token && role) loadData();
  }, [token, role]);

  const handleLogin = async (accessToken, userData, refreshToken = null) => {
    setLoading(true);
    try {
      const profiles = await sbFetch(`profiles?id=eq.${userData.id}`, {}, accessToken);
      const userRole = profiles[0]?.role || "conductor";
      const userTruck = profiles[0]?.truck_id || null;
      setToken(accessToken);
      setUser(userData);
      setRole(userRole);
      setTruckId(userTruck);
      localStorage.setItem("fleet_token", accessToken);
      localStorage.setItem("fleet_user", JSON.stringify(userData));
      localStorage.setItem("fleet_role", userRole);
      localStorage.setItem("fleet_truck", userTruck || "");
      if (refreshToken) localStorage.setItem("fleet_refresh", refreshToken);
    } catch (e) {
      setError("Error al obtener perfil");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setRole(null);
    setTruckId(null);
    setTasks([]);
    setCompleted([]);
    localStorage.clear();
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [active, done, sett, ops] = await Promise.all([
        sbFetch("tasks?order=created_at.desc&status=neq.completado", {}, token),
        sbFetch("tasks?order=created_at.desc&status=eq.completado", {}, token),
        sbFetch("settings?id=eq.1", {}, token).catch(() => []),
        sbFetch("operators?order=razon_social.asc", {}, token).catch(() => []),
      ]);
      setTasks(active || []);
      setCompleted(done || []);
      setSettings(sett?.[0] || null);
      setOperators(ops || []);
    } catch (e) {
      setError("Error al cargar. Comprueba tu conexión.");
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (data) => {
    setSettingsSaving(true);
    setError(null);
    try {
      const ALLOWED = [
        "razon_social",
        "cif",
        "domicilio",
        "telefono",
        "email",
        "nima",
        "autorizacion",
      ];
      const clean = {};
      for (const k of ALLOWED) clean[k] = data[k] ?? null;
      // upsert vía PATCH (la fila ya existe con id=1 por la migración)
      await sbFetch(
        "settings?id=eq.1",
        { method: "PATCH", body: JSON.stringify(clean), headers: { Prefer: "return=minimal" } },
        token
      );
      setSettings({ id: 1, ...clean });
    } catch (e) {
      setError("Error al guardar ajustes: " + (e.message || e));
    } finally {
      setSettingsSaving(false);
    }
  };

  const saveOperator = async (op) => {
    const ALLOWED = [
      "cif", "razon_social", "nima", "nro_inscripcion", "tipo_operador",
      "direccion", "cp", "municipio", "provincia", "telefono", "email",
    ];
    const clean = {};
    for (const k of ALLOWED) clean[k] = op[k] ?? null;
    if (op.id) {
      await sbFetch(
        `operators?id=eq.${op.id}`,
        { method: "PATCH", body: JSON.stringify(clean), headers: { Prefer: "return=minimal" } },
        token
      );
    } else {
      if (user?.id) clean.user_id = user.id;
      await sbFetch(
        "operators",
        { method: "POST", body: JSON.stringify(clean), headers: { Prefer: "return=minimal" } },
        token
      );
    }
    const ops = await sbFetch("operators?order=razon_social.asc", {}, token).catch(() => []);
    setOperators(ops || []);
    return ops || [];
  };

  const nextDiNumber = async (nima) => {
    if (!nima) return null;
    const year = new Date().getFullYear();
    const prefix = `${nima}/${year}/`;
    // PostgREST admite * como comodín en ilike — más fiable que % escapado.
    const filter = encodeURIComponent(`${prefix}*`);
    try {
      const rows = await sbFetch(
        `tasks?di_number=ilike.${filter}&select=di_number&order=di_number.desc&limit=50`,
        {},
        token
      );
      let n = 0;
      if (rows && rows.length) {
        for (const r of rows) {
          const m = (r.di_number || "").match(/\/(\d+)$/);
          if (m) { const v = parseInt(m[1], 10); if (v > n) n = v; }
        }
      }
      const next = String(n + 1).padStart(7, "0");
      return `${prefix}${next}`;
    } catch {
      return `${prefix}0000001`;
    }
  };

  const saveTask = async (form) => {
    setSaving(true);
    setError(null);
    try {
      // Sólo mandamos columnas conocidas de `tasks`. Evita que campos extra
      // (updated_at, user_id, created_at, etc.) viajen en PATCH/POST.
      const CORE = [
        "type",
        "truck",
        "client",
        "address",
        "lat",
        "lng",
        "time",
        "status",
        "weight",
        "notes",
      ];
      // Campos DAT: solo se mandan si tienen valor, para no romper
      // cuando la BD aún no tiene esas columnas.
      const DAT = [
        "ler_code",
        "waste_description",
        "quantity",
        "container_type",
        "origin_name",
        "origin_address",
        "origin_cif",
        "origin_nif",
        "origin_nima",
        "origin_nro_inscripcion",
        "origin_tipo_operador",
        "origin_cp",
        "origin_municipio",
        "origin_provincia",
        "origin_telefono",
        "origin_email",
        "destination_gestor",
        "destination_nima",
        "transport_date",
        "di_number",
        "start_date",
        "end_date",
      ];

      // Auto-generar Nº DI para recogidas con formato NIMA/AAAA/NNNNNNN.
      // También sobrescribe DIs antiguos tipo "DAT-XXXXXXXX" o cualquier
      // valor que no siga el formato pedido, siempre que haya NIMA/NIF.
      if (form.type === "recogida" && (form.origin_nima || form.origin_nif)) {
        const nima = form.origin_nima || form.origin_nif;
        const year = new Date().getFullYear();
        const expectedPrefix = `${nima}/${year}/`;
        const cur = form.di_number || "";
        const ok = cur.startsWith(expectedPrefix) && /\/\d{7}$/.test(cur);
        if (!ok) {
          const di = await nextDiNumber(nima);
          if (di) form.di_number = di;
        }
      }

      const clean = {};
      for (const k of CORE) {
        const v = form[k];
        if (k === "lat" || k === "lng") {
          const n = v === "" || v == null ? null : Number(v);
          clean[k] = Number.isFinite(n) ? n : null;
        } else if (k === "time") {
          clean[k] = v ? v : null;
        } else if (k === "weight") {
          clean[k] = v === "" || v == null ? null : v;
        } else if (["notes", "address", "client"].includes(k)) {
          clean[k] = v ?? "";
        } else {
          clean[k] = v == null || v === "" ? null : v;
        }
      }
      for (const k of DAT) {
        const v = form[k];
        if (v == null || v === "") continue; // omitir si vacío
        clean[k] = v;
      }

      const { id } = form;
      if (id) {
        await sbFetch(
          `tasks?id=eq.${id}`,
          { method: "PATCH", body: JSON.stringify(clean), headers: { Prefer: "return=minimal" } },
          token
        );
      } else {
        // Para satisfacer RLS: asignar user_id al creador.
        if (user?.id) clean.user_id = user.id;
        await sbFetch(
          "tasks",
          { method: "POST", body: JSON.stringify(clean), headers: { Prefer: "return=minimal" } },
          token
        );
      }
      setModal(null);
      await loadData();
    } catch (e) {
      setError("Error al guardar: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const markComplete = async (id) => {
    try {
      await sbFetch(
        `tasks?id=eq.${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "completado" }),
          headers: { Prefer: "return=minimal" },
        },
        token
      );
      await loadData();
    } catch {
      setError("Error al actualizar.");
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await sbFetch(
        `tasks?id=eq.${deleteId}`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
        token
      );
      setDeleteId(null);
      await loadData();
    } catch {
      setError("Error al eliminar.");
    } finally {
      setSaving(false);
    }
  };

  const cycleStatus = async (task) => {
    const order = ["pendiente", "en_ruta", "incidencia"];
    const next = order[(order.indexOf(task.status) + 1) % order.length];
    try {
      await sbFetch(
        `tasks?id=eq.${task.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: next }),
          headers: { Prefer: "return=minimal" },
        },
        token
      );
      setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    } catch {
      setError("Error al actualizar.");
    }
  };

  const isAdmin = role === "admin";

  const normalize = (s) => (s || "").toLowerCase();
  const q = normalize(searchText).trim();

  const matchSearch = (t) => {
    if (!q) return true;
    return [
      t.client,
      t.address,
      t.notes,
      t.ler_code,
      t.waste_description,
      t.origin_name,
      t.destination_gestor,
    ]
      .filter(Boolean)
      .some((s) => normalize(s).includes(q));
  };

  const sortFn = (a, b) => {
    if (sortBy === "hora") {
      return (a.time || "99:99").localeCompare(b.time || "99:99");
    }
    if (sortBy === "cliente") {
      return (a.client || "").localeCompare(b.client || "");
    }
    // recientes: por created_at desc (ya vienen así del server, pero por seguridad)
    return (b.created_at || "").localeCompare(a.created_at || "");
  };

  const source = activeTab === "activas" ? tasks : completed;
  const filtered = source
    .filter((t) => filterTruck === "all" || t.truck === filterTruck)
    .filter((t) => filterStatus === "all" || t.status === filterStatus)
    .filter(matchSearch)
    .sort(sortFn);
  const stats = {
    pendiente: tasks.filter((t) => t.status === "pendiente").length,
    en_ruta: tasks.filter((t) => t.status === "en_ruta").length,
    incidencia: tasks.filter((t) => t.status === "incidencia").length,
    completado: completed.length,
  };

  if (!token) return <LoginScreen onLogin={handleLogin} />;

  if (view === "ajustes") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#060D1A",
          color: "#E2E8F0",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          paddingBottom: 40,
        }}
      >
        <div
          style={{
            background: "#0A1628",
            borderBottom: "1px solid #1E2D3D",
            padding: "14px 16px",
            position: "sticky",
            top: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <button
            onClick={() => setView("tareas")}
            style={{
              background: "#1E2D3D",
              border: "none",
              color: "#94A3B8",
              width: 34,
              height: 34,
              borderRadius: 10,
              cursor: "pointer",
              fontSize: 16,
              fontFamily: "inherit",
            }}
          >
            ←
          </button>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Ajustes</div>
        </div>
        <SettingsScreen
          settings={settings}
          onSave={saveSettings}
          saving={settingsSaving}
          onBack={() => setView("tareas")}
          isAdmin={isAdmin}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#060D1A",
        color: "#E2E8F0",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        paddingBottom: 100,
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "#0A1628",
          borderBottom: "1px solid #1E2D3D",
          padding: "16px 16px 0",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "linear-gradient(135deg,#4F46E5,#7C3AED)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
              }}
            >
              🚛
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1 }}>FleetDesk</div>
              <div
                style={{
                  fontSize: 10,
                  color: isAdmin ? "#818CF8" : "#34D399",
                  marginTop: 2,
                  fontWeight: 600,
                }}
              >
                {isAdmin ? "👑 Administrador" : "🚛 Conductor"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={loadData}
              title="Refrescar"
              style={{
                background: "#1E2D3D",
                border: "none",
                color: "#94A3B8",
                width: 34,
                height: 34,
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 16,
                fontFamily: "inherit",
              }}
            >
              ↻
            </button>
            <button
              onClick={() => setView("ajustes")}
              title="Ajustes"
              style={{
                background: "#1E2D3D",
                border: "none",
                color: "#94A3B8",
                width: 34,
                height: 34,
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 14,
                fontFamily: "inherit",
              }}
            >
              ⚙️
            </button>
            <button
              onClick={handleLogout}
              title="Cerrar sesión"
              style={{
                background: "#1E2D3D",
                border: "none",
                color: "#94A3B8",
                width: 34,
                height: 34,
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 14,
                fontFamily: "inherit",
              }}
            >
              🚪
            </button>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 8,
            marginBottom: 14,
          }}
        >
          {[
            { label: "Pend.", value: stats.pendiente, color: "#F59E0B" },
            { label: "Ruta", value: stats.en_ruta, color: "#38BDF8" },
            { label: "Incid.", value: stats.incidencia, color: "#F87171" },
            { label: "Hecho", value: stats.completado, color: "#34D399" },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: "#0D1B2A",
                borderRadius: 10,
                padding: "8px 6px",
                textAlign: "center",
              }}
            >
              <div
                style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}
              >
                {s.value}
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: "#475569",
                  marginTop: 3,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex" }}>
          {[
            ["activas", "Activas"],
            ["completadas", "Completadas"],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setActiveTab(k)}
              style={{
                flex: 1,
                padding: "10px",
                border: "none",
                background: "transparent",
                color: activeTab === k ? "#818CF8" : "#475569",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                borderBottom:
                  activeTab === k ? "2px solid #818CF8" : "2px solid transparent",
                transition: "all 0.2s",
                fontFamily: "inherit",
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px" }}>
        {/* Buscador */}
        <div style={{ position: "relative", marginBottom: 10 }}>
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="🔎 Buscar por cliente, dirección, LER, notas..."
            style={{
              width: "100%",
              padding: "11px 14px 11px 14px",
              borderRadius: 10,
              border: "1px solid #1E2D3D",
              background: "#0D1B2A",
              color: "#E2E8F0",
              fontSize: 13,
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          {searchText && (
            <button
              onClick={() => setSearchText("")}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "#475569",
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Filtros estado */}
        {activeTab === "activas" && (
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 10,
              overflowX: "auto",
              paddingBottom: 2,
            }}
          >
            {[
              { k: "all", l: "Todos", c: "#94A3B8" },
              { k: "pendiente", l: "Pendiente", c: STATUS_CONFIG.pendiente.color },
              { k: "en_ruta", l: "En ruta", c: STATUS_CONFIG.en_ruta.color },
              { k: "incidencia", l: "Incidencia", c: STATUS_CONFIG.incidencia.color },
            ].map((f) => {
              const active = filterStatus === f.k;
              return (
                <button
                  key={f.k}
                  onClick={() => setFilterStatus(f.k)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 99,
                    border: `1px solid ${active ? f.c : "#1E2D3D"}`,
                    background: active ? `${f.c}20` : "transparent",
                    color: active ? f.c : "#64748B",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    fontFamily: "inherit",
                  }}
                >
                  {f.l}
                </button>
              );
            })}
          </div>
        )}

        {/* Conductor + orden */}
        <div
          style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}
        >
          {isAdmin && (
          <select
            value={filterTruck}
            onChange={(e) => setFilterTruck(e.target.value)}
            style={{
              flex: 1,
              padding: "9px 12px",
              borderRadius: 10,
              border: "1px solid #1E2D3D",
              background: "#0D1B2A",
              color: "#E2E8F0",
              fontSize: 13,
              outline: "none",
              fontFamily: "inherit",
            }}
          >
            <option value="all">Todos los conductores</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.driver}
              </option>
            ))}
          </select>
          )}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: "9px 12px",
              borderRadius: 10,
              border: "1px solid #1E2D3D",
              background: "#0D1B2A",
              color: "#E2E8F0",
              fontSize: 13,
              outline: "none",
              fontFamily: "inherit",
            }}
          >
            <option value="recientes">Recientes</option>
            <option value="hora">Por hora</option>
            <option value="cliente">Por cliente</option>
          </select>
          <div style={{ color: "#475569", fontSize: 12, whiteSpace: "nowrap" }}>
            {filtered.length}
          </div>
        </div>

        {error && (
          <div
            style={{
              background: "rgba(248,113,113,0.1)",
              border: "1px solid #F87171",
              borderRadius: 12,
              padding: "12px 16px",
              marginBottom: 14,
              color: "#F87171",
              fontSize: 13,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            {error}
            <button
              onClick={() => setError(null)}
              style={{
                background: "none",
                border: "none",
                color: "#F87171",
                cursor: "pointer",
                fontSize: 18,
              }}
            >
              ×
            </button>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#475569" }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>⏳</div>
            <div style={{ fontSize: 14 }}>Cargando...</div>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#334155" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {activeTab === "activas" ? "No hay tareas activas" : "No hay tareas completadas"}
            </div>
            {activeTab === "activas" && (isAdmin || truckId) && (
              <div style={{ fontSize: 13, marginTop: 6, color: "#1E2D3D" }}>
                {isAdmin ? "Pulsa + para añadir una" : "Pulsa + para crear una recogida"}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((task) => {
            const truck = trucks.find((t) => t.id === task.truck);
            const isCompleted = task.status === "completado";
            return (
              <div
                key={task.id}
                style={{
                  background: "#0A1628",
                  border: `1px solid ${
                    isCompleted
                      ? "#1E2D3D"
                      : (TYPE_CONFIG[task.type]?.color + "40") || "#1E2D3D"
                  }`,
                  borderRadius: 16,
                  overflow: "hidden",
                  opacity: isCompleted ? 0.75 : 1,
                }}
              >
                <div
                  style={{
                    height: 3,
                    background: isCompleted
                      ? "#1E2D3D"
                      : `linear-gradient(90deg, ${TYPE_CONFIG[task.type]?.color}, transparent)`,
                  }}
                />
                <div style={{ padding: "14px 14px 12px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <TypeBadge type={task.type} />
                    <Badge status={task.status} />
                    {task.time && (
                      <span
                        style={{
                          marginLeft: "auto",
                          color: "#94A3B8",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        🕐 {task.time}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 16,
                      color: "#F1F5F9",
                      marginBottom: 4,
                    }}
                  >
                    {task.client || "Sin cliente"}
                  </div>
                  {task.address && !task.lat && (
                    <div style={{ color: "#64748B", fontSize: 13, marginBottom: 6 }}>
                      📍 {task.address}
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      flexWrap: "wrap",
                      marginBottom: 4,
                    }}
                  >
                    {truck && (
                      <span style={{ color: "#475569", fontSize: 12 }}>🚛 {truck.driver}</span>
                    )}
                    {task.weight && (
                      <span style={{ color: "#475569", fontSize: 12 }}>⚖️ {task.weight}</span>
                    )}
                    {task.notes && (
                      <span style={{ color: "#92400E", fontSize: 12 }}>📝 {task.notes}</span>
                    )}
                  </div>
                  {task.lat && task.lng && (
                    <MiniMap lat={parseFloat(task.lat)} lng={parseFloat(task.lng)} />
                  )}
                  {!isCompleted && (
                    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                      <button
                        onClick={() => markComplete(task.id)}
                        style={{
                          flex: 2,
                          minWidth: 120,
                          padding: "10px",
                          borderRadius: 10,
                          border: "none",
                          background: "rgba(52,211,153,0.15)",
                          color: "#34D399",
                          cursor: "pointer",
                          fontWeight: 700,
                          fontSize: 13,
                          fontFamily: "inherit",
                        }}
                      >
                        ✅ Completar
                      </button>
                      <button
                        onClick={() => cycleStatus(task)}
                        style={{
                          flex: 1,
                          minWidth: 80,
                          padding: "10px",
                          borderRadius: 10,
                          border: "1px solid #1E2D3D",
                          background: "transparent",
                          color: "#94A3B8",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 600,
                          fontFamily: "inherit",
                        }}
                      >
                        ⟳ Estado
                      </button>
                      <button
                        onClick={() =>
                          generateDIR(task, settings, trucks.find((t) => t.id === task.truck)).catch(
                            (err) => setError("No se pudo generar el DIR: " + err.message)
                          )
                        }
                        title="Generar DIR"
                        style={{
                          width: 44,
                          padding: "10px",
                          borderRadius: 10,
                          border: "1px solid #1E2D3D",
                          background: "transparent",
                          color: "#A78BFA",
                          cursor: "pointer",
                          fontSize: 14,
                          fontFamily: "inherit",
                        }}
                      >
                        📄
                      </button>
                      <button
                        onClick={() => setModal(task)}
                        style={{
                          width: 40,
                          padding: "10px",
                          borderRadius: 10,
                          border: "1px solid #1E2D3D",
                          background: "transparent",
                          color: "#818CF8",
                          cursor: "pointer",
                          fontSize: 15,
                          fontFamily: "inherit",
                        }}
                      >
                        ✏️
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => setDeleteId(task.id)}
                          style={{
                            width: 40,
                            padding: "10px",
                            borderRadius: 10,
                            border: "1px solid #1E2D3D",
                            background: "transparent",
                            color: "#F87171",
                            cursor: "pointer",
                            fontSize: 15,
                            fontFamily: "inherit",
                          }}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  )}
                  {isCompleted && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 8,
                        marginTop: 10,
                      }}
                    >
                      <button
                        onClick={() =>
                          generateDIR(task, settings, trucks.find((t) => t.id === task.truck)).catch(
                            (err) => setError("No se pudo generar el DIR: " + err.message)
                          )
                        }
                        style={{
                          padding: "8px 14px",
                          borderRadius: 10,
                          border: "1px solid #1E2D3D",
                          background: "transparent",
                          color: "#A78BFA",
                          cursor: "pointer",
                          fontSize: 12,
                          fontFamily: "inherit",
                        }}
                      >
                        📄 DIR
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => setDeleteId(task.id)}
                          style={{
                            padding: "8px 14px",
                            borderRadius: 10,
                            border: "1px solid #1E2D3D",
                            background: "transparent",
                            color: "#475569",
                            cursor: "pointer",
                            fontSize: 12,
                            fontFamily: "inherit",
                          }}
                        >
                          🗑 Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* FAB: admin siempre, conductor sólo si tiene camión asignado */}
      {activeTab === "activas" && (isAdmin || truckId) && (
        <button
          onClick={() => setModal("new")}
          title={isAdmin ? "Nueva tarea" : "Nueva recogida"}
          style={{
            position: "fixed",
            bottom: 28,
            right: 20,
            width: 58,
            height: 58,
            borderRadius: 29,
            background: "linear-gradient(135deg,#4F46E5,#7C3AED)",
            border: "none",
            color: "#fff",
            fontSize: 28,
            cursor: "pointer",
            boxShadow: "0 8px 32px rgba(79,70,229,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
          }}
        >
          +
        </button>
      )}

      {modal && (
        <TaskModal
          task={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSave={saveTask}
          loading={saving}
          isAdmin={isAdmin}
          userTruck={truckId}
          operators={operators}
          onSaveOperator={saveOperator}
          onNextDi={nextDiNumber}
        />
      )}
      {deleteId && (
        <DeleteModal
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
          loading={saving}
        />
      )}
    </div>
  );
}
