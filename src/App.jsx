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

async function generateDAT(task, settings, truck) {
  await loadJsPdf();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const M = 15; // margin
  let y = M;
  const W = 210 - 2 * M;

  // Cabecera
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, 210, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("FLEETDESK", M, 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Gestión de rutas y entregas", 210 - M, 7, { align: "right" });

  y = 20;
  doc.setTextColor(20, 30, 50);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Documento que acompaña al transporte", M, y);
  y += 5;
  doc.setFontSize(10);
  doc.setTextColor(90, 100, 120);
  doc.text("Residuos no peligrosos · Ley 7/2022 · RD 553/2020", M, y);
  y += 8;

  // Fecha y nº DI
  doc.setTextColor(20, 30, 50);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const shortId = (task.id || "").toString().slice(0, 8).toUpperCase();
  const diNumber = task.di_number || `DAT-${shortId}`;
  doc.setFont("helvetica", "bold");
  doc.text(`Documento de Identificación nº: ${diNumber}`, M, y);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Fecha del transporte: ${fmtDate(task.transport_date || task.created_at)}`,
    210 - M,
    y,
    { align: "right" }
  );
  y += 5;
  if (task.start_date || task.end_date) {
    doc.text(
      `Inicio: ${fmtDate(task.start_date) || "—"}    Fin: ${fmtDate(task.end_date) || "—"}`,
      M,
      y
    );
    y += 5;
  }
  y += 3;

  const box = (title, lines) => {
    doc.setDrawColor(220, 225, 235);
    doc.setFillColor(250, 251, 253);
    const h = 8 + lines.length * 5 + 2;
    doc.rect(M, y, W, h, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(79, 70, 229);
    doc.text(title, M + 3, y + 5.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(30, 40, 60);
    lines.forEach((ln, i) => doc.text(ln, M + 3, y + 11 + i * 5));
    y += h + 3;
  };

  // Emisor / Transportista (datos de la empresa)
  // Si la tabla settings está vacía usamos los datos fijos de RECIPALETS TOTANA S.L.
  const emisor = settings || {};
  box("TRANSPORTISTA / EMISOR", [
    `Razón social: ${emisor.razon_social || "RECIPALETS TOTANA S.L."}`,
    `CIF/NIF: ${emisor.cif || "B73384059"}`,
    `Domicilio: ${emisor.domicilio || "Autovía del Mediterráneo KM 609"}`,
    `Tel.: ${emisor.telefono || "637543518"}    Email: ${emisor.email || "medioambiente@jcpalets.com"}`,
    `NIMA: ${emisor.nima || "3020143940"}`,
    `Conductor: ${truck ? `${truck.driver} (${truck.id})` : task.truck || "—"}`,
  ]);

  // Operador del traslado (productor del residuo)
  const opNif = task.origin_nif || task.origin_cif || "—";
  const opNima = task.origin_nima || "—";
  const opInsc = task.origin_nro_inscripcion || "—";
  const opTipo = task.origin_tipo_operador || "—";
  const opAddr = task.origin_address || task.address || "—";
  const opCp = task.origin_cp || "—";
  const opMun = task.origin_municipio || "—";
  const opProv = task.origin_provincia || "—";
  const opTel = task.origin_telefono || "—";
  const opMail = task.origin_email || "—";
  const opName = task.origin_name || task.client || "—";

  box("INFORMACIÓN RELATIVA AL OPERADOR DEL TRASLADO", [
    `NIF: ${opNif}    Razón social: ${opName}`,
    `NIMA: ${opNima}    Nº inscripción: ${opInsc}    Tipo operador: ${opTipo}`,
    `Dirección: ${opAddr}    C.P.: ${opCp}`,
    `Municipio: ${opMun}    Provincia: ${opProv}`,
    `Teléfono: ${opTel}    Email: ${opMail}`,
  ]);

  // Origen del traslado (mismos datos)
  box("INFORMACIÓN RELATIVA AL ORIGEN DEL TRASLADO", [
    `NIF: ${opNif}    Razón social: ${opName}`,
    `NIMA: ${opNima}    Nº inscripción: ${opInsc}    Tipo centro productor: ${opTipo}`,
    `Dirección: ${opAddr}    C.P.: ${opCp}`,
    `Municipio: ${opMun}    Provincia: ${opProv}`,
    `Teléfono: ${opTel}    Email: ${opMail}`,
  ]);

  // Gestor / Destino (RECIPALETS como fallback si la tarea antigua no tiene los datos)
  box("GESTOR / DESTINO", [
    `Nombre gestor: ${task.destination_gestor || "RECIPALETS TOTANA S.L."}`,
    `CIF/NIF: ${task.destination_cif || "B73384059"}`,
    `Domicilio: ${task.destination_address || "Autovía del Mediterráneo Km 609, 30850 TOTANA (Murcia)"}`,
    `NIMA: ${task.destination_nima || "3020143940"}`,
    `Tel.: ${task.destination_phone || "637543518"}    Email: ${task.destination_email || "medioambiente@jcpalets.com"}`,
  ]);

  // Residuo
  box("RESIDUO", [
    `Código LER: ${task.ler_code || "—"}`,
    `Descripción: ${task.waste_description || "—"}`,
    `Cantidad: ${task.quantity || task.weight || "—"}`,
    `Tipo envase: ${task.container_type || "Palets de madera rotos"}`,
  ]);

  // Observaciones
  box("OBSERVACIONES", [task.notes || "—"]);

  // Firmas (en la de transportista estampamos el sello RECIPALETS)
  y += 4;
  const colW = (W - 6) / 2;
  const firmaH = 34;
  ["Firma productor", "Firma transportista"].forEach((label, i) => {
    const x = M + (colW + 6) * i;
    doc.setDrawColor(200, 205, 215);
    doc.rect(x, y, colW, firmaH);
    doc.setFontSize(8);
    doc.setTextColor(100, 110, 130);
    doc.text(label, x + 3, y + 5);
    if (i === 1) {
      // Sello azul estilo estampado real
      const cx = x + colW / 2;
      doc.setTextColor(25, 55, 155);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("RECIPALETS TOTANA S.L.", cx, y + 13, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text("C.I.F.: B-73384059", cx, y + 17, { align: "center" });
      doc.text("Autovía del Mediterráneo Km 609", cx, y + 21, { align: "center" });
      doc.text("30850 TOTANA (Murcia)", cx, y + 25, { align: "center" });
      doc.text("Tlf. +34 637 54 35 18", cx, y + 29, { align: "center" });
      // Reset de estilos para el resto del PDF
      doc.setTextColor(30, 40, 60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
    }
  });
  y += firmaH + 6;

  // Pie
  doc.setFontSize(7);
  doc.setTextColor(120, 130, 150);
  doc.text(
    "Documento generado con FleetDesk. Conserve una copia mientras dure la operación de transporte.",
    M,
    287
  );

  const fname = `DAT_${(emisor.razon_social || "fleetdesk")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase()}_${shortId}.pdf`;
  doc.save(fname);
}

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
      onLogin(data.access_token, data.user);
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

    // Restore session
    const savedToken = sessionStorage.getItem("fleet_token");
    const savedUser = sessionStorage.getItem("fleet_user");
    const savedRole = sessionStorage.getItem("fleet_role");
    const savedTruck = sessionStorage.getItem("fleet_truck");
    if (savedToken && savedUser && savedRole) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      setRole(savedRole);
      if (savedTruck && savedTruck !== "null") setTruckId(savedTruck);
    }
  }, []);

  useEffect(() => {
    if (token && role) loadData();
  }, [token, role]);

  const handleLogin = async (accessToken, userData) => {
    setLoading(true);
    try {
      const profiles = await sbFetch(`profiles?id=eq.${userData.id}`, {}, accessToken);
      const userRole = profiles[0]?.role || "conductor";
      const userTruck = profiles[0]?.truck_id || null;
      setToken(accessToken);
      setUser(userData);
      setRole(userRole);
      setTruckId(userTruck);
      sessionStorage.setItem("fleet_token", accessToken);
      sessionStorage.setItem("fleet_user", JSON.stringify(userData));
      sessionStorage.setItem("fleet_role", userRole);
      sessionStorage.setItem("fleet_truck", userTruck || "");
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
    sessionStorage.clear();
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
                          generateDAT(task, settings, trucks.find((t) => t.id === task.truck)).catch(
                            (err) => setError("No se pudo generar el DAT: " + err.message)
                          )
                        }
                        title="Generar DAT"
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
                          generateDAT(task, settings, trucks.find((t) => t.id === task.truck)).catch(
                            (err) => setError("No se pudo generar el DAT: " + err.message)
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
                        📄 DAT
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
