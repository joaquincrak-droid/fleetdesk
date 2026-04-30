import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://jfzyueilhrbzkvllyjfd.supabase.co";

// Clave pública VAPID — generada una vez con node + crypto, se
// puede compartir libremente (la privada vive sólo en Supabase).
const VAPID_PUBLIC_KEY =
  "BJm2Z-rk0dyni6MYKsH4gWZQdglsS0UMJhxIQbgk3lZ9x1mAvSLEmezxjLwHMOkLajlDkYcWCmIzjfuqxty7K_Q";

// Convierte la clave VAPID base64url a Uint8Array (lo que pide
// pushManager.subscribe).
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Registra el service worker, pide permiso al usuario y guarda
// la suscripción en Supabase (idempotente).
async function enablePushNotifications(token, userId) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Tu navegador no soporta notificaciones push.");
  }
  if (Notification.permission === "denied") {
    throw new Error("Has bloqueado las notificaciones para esta web. Actívalas desde los ajustes del navegador.");
  }
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  if (Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Permiso denegado.");
  }
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = sub.toJSON();
  await sbFetch(
    "push_subscriptions",
    {
      method: "POST",
      headers: {
        Prefer: "return=minimal,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id: userId,
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        user_agent: navigator.userAgent.slice(0, 200),
      }),
    },
    token,
  );
  return true;
}
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impmenl1ZWlsaHJiemt2bGx5amZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgxOTksImV4cCI6MjA5MTg1NDE5OX0.sQms7Rbuv4d3WFQujtkE9KSvg7XBmCNrsp9TJS7Se7k";

// Camiones de la flota. La matrícula aparece en el PDF del albarán
// y en el cuerpo del correo. Si cambias un camión actualiza aquí
// el campo "plate".
const trucks = [
  { id: "T-01", name: "Camión 1", driver: "Miguel", plate: "9390MMC" },
  { id: "T-02", name: "Camión 2", driver: "Juan",   plate: "6598MRY" },
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
// Refresca el access_token usando el refresh_token guardado en
// localStorage. Devuelve el nuevo access_token o lanza error si
// no hay refresh o ha caducado del todo.
async function refreshSession() {
  const rt = localStorage.getItem("fleet_refresh");
  if (!rt) throw new Error("Sin refresh_token");
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    },
  );
  if (!res.ok) throw new Error("No se pudo refrescar la sesión");
  const data = await res.json();
  if (!data.access_token) throw new Error("Respuesta inválida al refrescar");
  localStorage.setItem("fleet_token", data.access_token);
  if (data.refresh_token) localStorage.setItem("fleet_refresh", data.refresh_token);
  // Avisar a la app para que actualice el estado de React
  window.dispatchEvent(
    new CustomEvent("fleet:token-refreshed", { detail: data.access_token }),
  );
  return data.access_token;
}

async function sbFetch(path, options = {}, token = null) {
  const useToken = token || localStorage.getItem("fleet_token") || SUPABASE_KEY;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${useToken}`,
    "Content-Type": "application/json",
    ...options.headers,
  };
  let res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers });
  if (!res.ok) {
    const errText = await res.clone().text();
    const isExpired =
      res.status === 401 ||
      errText.includes("JWT expired") ||
      errText.includes("PGRST303");
    if (isExpired) {
      try {
        const newToken = await refreshSession();
        const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };
        res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
          ...options,
          headers: retryHeaders,
        });
        if (!res.ok) throw new Error(await res.text());
        const t = await res.text();
        return t ? JSON.parse(t) : [];
      } catch {
        throw new Error("Tu sesión ha expirado. Vuelve a iniciar sesión.");
      }
    }
    throw new Error(errText);
  }
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
  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

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
      boxZoom: false,
      keyboard: false,
    }).setView([lat, lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    const icon = L.divIcon({
      html: `<div style="font-size:24px;line-height:1">📍</div>`,
      className: "",
      iconAnchor: [12, 24],
      iconSize: [24, 24],
    });
    L.marker([lat, lng], { icon }).addTo(map);

    // Cuando el usuario pulse en el mapa (cualquier parte) lo
    // tratamos como un click en "Navegar": abre Google Maps con
    // la ruta. Usamos location.href en lugar de window.open para
    // que el móvil abra directamente la app de Maps en vez de
    // bloquearlo como popup.
    const onClick = () => {
      window.location.href = navUrl;
    };
    map.on("click", onClick);

    return () => {
      map.off("click", onClick);
      map.remove();
    };
  }, [ready, lat, lng, navUrl]);

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
      {/* Capa transparente clicable: hace de "navegar al sitio"
          aunque Leaflet no haya capturado el click bien (móviles). */}
      <a
        href={navUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div ref={ref} style={{ height: 130, width: "100%", cursor: "pointer" }} />
      </a>
      <a
        href={navUrl}
        target="_blank"
        rel="noopener noreferrer"
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
          textDecoration: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}
      >
        🚗 Navegar
      </a>
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
async function generateDIR(task, settings, truck, opts = {}) {
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

  // Los superíndices unicode (⁴,⁶,⁸,⁹,¹⁰,¹¹,¹²,¹³,¹⁴,¹⁵) no existen
  // en la fuente helvetica embebida de jsPDF y aparecen sustituidos
  // por letras al azar (t,p,v,x,y…) que se pegan al valor y parecen
  // pisarlo. Los pasamos a dígitos normales para que se lea bien.
  const cleanSup = (s) => String(s).replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, (ch) => (
    { "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5",
      "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁰": "0" }[ch] || ""
  ));

  const sectionHeader = (y, text) => {
    const t = cleanSup(text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(t, W - 4);
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
    const t = cleanSup(text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    const lines = doc.splitTextToSize(t, W - 4);
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
      const v = c.value == null ? "" : cleanSup(c.value);
      const label = c.label ? cleanSup(c.label) : "";
      if (label) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(label, x + 1.5, y + 3);
        const labelW = doc.getTextWidth(label);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        const vw = doc.getTextWidth(v);
        // Si etiqueta + valor caben holgadamente, van en la misma línea
        if (labelW + vw + 6 <= c.w) {
          doc.text(v, x + 1.5 + labelW + 3, y + 3);
        } else if (h >= 9) {
          // Con celda alta, valor en segunda línea (sin apilado)
          const lines = doc.splitTextToSize(v, Math.max(c.w - 3, 10));
          lines.slice(0, Math.floor((h - 4) / 3.2)).forEach((ln, i) =>
            doc.text(ln, x + 1.5, y + 7 + i * 3.2)
          );
        } else {
          // Celda estrecha: truncamos para no pisar nada
          doc.text(v, x + 1.5 + labelW + 3, y + 3, {
            maxWidth: Math.max(c.w - labelW - 5, 10),
          });
        }
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        const lines = doc.splitTextToSize(v, Math.max(c.w - 3, 10));
        lines.slice(0, Math.max(1, Math.floor(h / 3.2))).forEach((ln, i) =>
          doc.text(ln, x + 1.5, y + 4 + i * 3.2)
        );
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
    "Documento generado por RECIPALETS TOTANA S.L. · Conserve una copia durante el transporte.",
    M, PAGE_H - 6
  );

  // Guardar o devolver como base64
  const cliente = (task.origin_name || task.client || "cliente")
    .toString()
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase()
    .slice(0, 24);
  const fname = `DIR_${diNumber.replace(/\//g, "-")}_${cliente}.pdf`;
  if (opts && opts.mode === "base64") {
    const datauri = doc.output("datauristring");
    return { datauri, filename: fname, diNumber };
  }
  doc.save(fname);
}

// Alias por compatibilidad con llamadas antiguas
const generateDAT = generateDIR;

// ── Envío por correo del DIR ──────────────────────────────────
// El PDF se genera en el navegador y se manda (junto con la
// firma corporativa de RECIPALETS) a una Edge Function de
// Supabase, que lo reenvía a través de Microsoft Graph API
// desde recipalets@jcpalets.com con copia a RECIPALETS.
//
// Logos de la firma embebidos como PNG base64 (para que el
// correo se vea visualmente igual aunque el cliente bloquee
// imágenes externas).
const SIG_BANNER_B64 = "iVBORw0KGgoAAAANSUhEUgAAAcwAAACMCAMAAADGKmlsAAAAwFBMVEX////9///+//7///r+/v7//f78/f7+/fz+/fn8+fj88+T06eP758X72r7u17z3x6vjxZX0upr0rorft27PsXLzpn/0oHbuoXjul2vwj1/JoVbClEiwllGvjj3viFPvf0bueD3ucjTvaSfsaSjraCbqaCXsZSHqZSTqZSLqZSDbeUDkaCfpZSPmZiSviDCveh+hgTaYbiLsZCLpZCHqYR7bXiDKVx2dXQ6VSxNoTDVlNBhSHwwaExAGAgIAAgMAAADbdUpFAABP6klEQVR42u19h3riyNatyNEkyw0GYZskEAKMQGBEMO//VnetXSURjN1uz/znzpzv1EwTFEpYSzuHMjbr/+KxWq1X4z8bLfzfajWbzccmR+NymGa9bt4ctZpZ+c4ol348Cl8N7C4Z62631+33/o2jj5+OgZdOp9vtXI2X03iOxtPZeDwbZ3j9CsdDOGrno3o5yh/G3YdRPI3w1uc/jtz5yGazCRlxDOObo2Cs+/7SdhYL5185lsPhaDEYANbBYEBkOx3+uw3q8/n4BNYboNZ/iGrpO6jeRjd3NbIcmUw6nU5+OjJJgNlbToej4b9yAMBBv9/tD6ajgRsR6e+BvMTy2xT68CdQ3qDQMzi/APIKyWxOcORIpZJf0GWSlNn1JwtQ5r9xENB+Hzh2wWV7rtshmr1PeO1nhPn4+CVh1r9BluVbo3SDMgu3CfNzMI1s7hLMTC6d/ALMvjNx/q1jNBoNlr3OarPZrN2OYrK9znfY7G8pM8TyD8C8u7ugzNJHsqx8hzLP0MyW8okzMJMxopb+Aswe5I7zEyY3+dYh4IPR+Ju5LGaf9Ked9XZ/OB4P++242+t8SpjP35GYj9/lstdsVvA0ra/ZbCE4BL8nzDMsDesQFMhnQ8pMGyWzYCT/BjBHI6hJw+F0uliMFr6/6A6dyeT6EBxA/jcZDR17MRw4ju+v9PBxDk4fcgqbLPIvSWqebNsDt7PZH4/vh8P78bhfXxHmy0vnMyxDOB/5/yWYCtE6qJKEWY/QrD2cQXkFp2B5OAZ3Z0z2mjKLpf3xUCp8VH4+hxN/WskgmBrPZGF/DE5a0A0wnSExGv12OM7QWU6h9vort9Nxgc5k6vjDq2MApGODAU5GNg5cuePHeq1awV9fbzyNXSDq2MOlM8E1ndFfG/g9i2l3fTgCyANp87h3SZq9yEx5uaTP3wvNxoUCVP9CaN4A0zq+b6+FZukWmB/5rOBZOAMzH4J5IJjgtxn8i+fSpeP7HlIzmc5ljHQunf4LYLpQfG1/9Vgt4tKluuv3hteQYK6JO3Xs/tBfjR9rpUIuEV0um7+rNsYrn8JuOPw7wByO3P374X2/3Wy2++P7EaQ56DwDNg1j53k8fn5WKAqYiiQfH/WbjCcF4q/Hxi9NlQ1Q5K+GEGXtl6LNMwj5WiZ+Z/ISG+6s4zEo3gmDjTAMPxSAYT6iTAHuBCWhy+YhHRWUCQMMltZlFmC+l/jNMPgvmzMK78c9pGZSb/k5mCN7OnUG/ris4YkXn/zF9BISsFDHXro933cfqwUeGI8n0xlhEolMDAI8XyaefXc6Wv5FMIcL2+luj+/vuzFxc3eHndvtvay3u91uMyacL2N83r4+bXb7XTAGqGsI1oC7SZHj3a4d7Hct4OlhW9AIdpZC81drtwWgjYf5PnioU2zWzN22ThStfVCtlc1gtw8sosmPu8AkYYIn7gMTaFrb/XZeCoLKSVqqowTMu3zJCnB2IYQzb+3NEvdXEsQyLp9LpcDKaTCNgpyQM9KVAEwoMHNGTk1xLj7/EExwxoXjlo00RHEC+MTyY79/deLEtp3Bwh/X74BkEqw+HovF8Q8viUQyw+9GoQY47cnkr4I5tIfuDux13RnafbfjrjvQgLZguBgE+MXb8+NhJ1v24+enLfQkvfvpMSBnPhy3jbE+AJs1YWJXUAOcuPvmgxAmt1QhNrGlXg3UNQIQpKnmC+7Mo/D6/V0lmm1bDBlsIJuw/1Aq5iv6J5QUmvkS5IPaZJE+LZmcv7MSJ/pxIzyhkMF3firk1IT7wpnc/EMwIQsHq5qREdmbSoHq71zn8sQJtSnfrReMGOW0qGB40S4peqfSZPR5wGkv/iKasKi6K96zzrQnPgNQ58v2eFAY7V46Y/ztvMHHd3nfPT3vjuo7vwDMw/s7wdypc7Bvr9QfgPm+J2HyTYEpH2tVvvGFE0LfKdfI3HkBq7zlpn1wx9kOarYQS0vEuvyuUr5ywOF7nl0IwXznHPxVZjZb4Tt/5OHdNERmlqITksEev3gf5EyAzSeqZGR+CuYQNDfOpzP0F8Yz6XQ2bdRXiytqGfmrRtGIAUWADrYK4OPRMIwYNqSzhlGAxO0P/xqYoyXUn3cFJrSentvt8PvOW+PGHjfPG/zJ3pg3dzveYIv3JJ/nc2LqNfB07+bb3eOc0LdbAd80ZTb278f5Qx2vQU2rs9xSBXZ45TXMyg63tYxz95a5xYYyZeaWr7jrZkVmCwUnINhbFWt/eAeY2LM3C9xfyUdgym68FXI7zlgiRz5qMPlkqRNKRoXkmDYCeRQsM/dzmTmZ9P26kRYqiyfSsXgmVlrZE00mVE8nwy5kaspIp3BEEgfGjZiw2GQ89BjLB4jPRAnEOZjawx8j6kBgr/YE0+kzUuAOup0t2elL5xnvO0B3DJ6f57iF4LD88rg7vu9gjDzxLOGljcfHXxC7OxDkL56rNaAH7NvXoJ7uGw9KmyWf3VctTZj7ikV2vitj6/zuDkbJoSIK0N0dbv1Oc1YNZtEEsZn5Yt4EWZUA3QEiEr/gUIrABG55o4L3kvqSAzkqMI+lAifHCaDVUrKEXwHWZlJ1DypUhZI/ZbPDxaoaEXY8aUBqvmjbBHd2Olr07dVjwTAyid94+vEcZI18fTUc+sufM1tckjJz7yrHbMftvODr9gWGk4fNYKogz5f5gfhCXAqYIM/nZ4rLHSkzALKNnQK1wQM1mCBNSDCeUgtNkzq38BQCKDIOd7OMc6kHUbYqMLllDiWI33YRlz3ui0KhwANsVDjkMaicycwC9VtMahKtAtRaUKgGk1ug9xzfg5Jh8EsumQllJths8sd25tDF6fEIzGQs9xwZmtP+xF6sHnLgsLHfgYmTM9m4UXb9gbP8CxqQaLMgTYmAbfc7qjLb517vZYNbKWC+vIwFzOdzMJ8+gPnr8akxP1EmSfOdXLH5EIJZ5RaCVg1EpO3n1btqdfsBTF6nWC4XIzBLAmYptDMBJv0bQSmRL1yCWaDOo8EUf0EI5rs8OQVaIwImJFWhEpARB7lk+qeUOR25xUsws08hZTqToe2AcGNQeWLJ38beRDmKFaEO/9zOHPUXvfWe2szadddgoccNxeQaAJKPXlBmCOYBms/jOGKzBJMotX79IqgRmL8aYHc4qFYP/Xk1E6INMrQKXgvdxiqX5/PqR8okm91XigTuqBWgYgUs0wJaYNJgs9RhrELWnJ9ps0crnjWwm0wV14B0Mo8Rm1UnGBWrkNSUmQsOQQ5aEGSs8VMw7cliXDiBCfEXyz6GlAmTxIfZkskmob+mvhVMTWSNwti3f+406A2n3c2B2t9+T0fQYT2m2rjbQcc8eM8iM6/Y7AFMjg/1YR5S5mP7oDa+n9iskCbmsx4iMEma3AJjc39UkxznN8A0DxRnQjehAlTkcxaARwOVChWg9yDgbzuBqXbjxHyCb/hyOJwpQNgiJwDMd1JmAbS6q1jvfwXMycgnmEYEZuYE5mSycFYwQWl9xGLfQFIUo2wcaA5+7gFyB06HaOLZBtUcNh1807bC9qWzOxDMMeiIlPn+vqUCJHux++kp4JYnIU16dt+VaRI685rgstuHM097rUnzhk5ZS66BSQDmQYF5EDAP27sySVNblRGYpjI2uK0ifiB+PAdT7YSik83p3do0ObyXjEJ0AinzsM+lc0G45ccyczRd+O4JTGgxieQZmCNgmc3Gk8lEIhn7Dphx8NosOe1w+UM7czhwBm5nvVNm9m7d6bkvG7Gw95uXDm1OjywX4vMFdspxQ9NkL7eBKEJJ2pAyHxuB2gasfp0cs7iFQpgnRztI2aoqN5BcMKhCGTqYZXLbfYVuAzraS4HaSbd7hKacAIaxLxUL6oBj8MFpsKcLKFtSn3FQhURZyCQK+oRCWhztSZBmuCWZ/imYE5tgJk9gxgVMmiRTpejGqfnEEykFdSKm7RFsJiHG6DXA9vB0I5WJpY0qTNXJdPHnnlqGbJxBz4Z1ud1uN2sJZvY64w2+0Jv3Mt5snjsvz952/PzCL+Pn3fvRa223wZwU+bQhlvTQNlrBNmj9mgetkDDnzeDwvnuo1y8c7YEVOmitIJgDxWpFnHrlinLoBSr2ZQZBYBatc3deCSdYxVJgimu2Mg+gy14oQDjHKog7L8HPZh5WZDZbsCoZumZxukVDJINPQCAZbUkayR87DS7ANICQBtMB0Tay6ZMSGxeFNRWDXhtLiyMoncFvSOJrKnWp1ubG/mT4EzDxgwbDfr8/GKgoiUCJfwyQXITAnnXM5IXGpvfIsNezCpfoqMnTY0Oc7CFd1kHTIjEvotMPEvnScJYjP/vJ2x4GpwW/8l3xIpYJ06NYzKuYifjTIz+7gMkErjBmwvtCCHMMUjBxRPkGGJ1WqBnaurwIgv09YDIA0vfH+Vg2aaROu2KxVBLElzrFaejbS10nsqQStdVgOJws/gKYAxfjlLX3Wd4IwDwcaJr8LjgNFkvF9YERk3MwH2p/KQuoWLy7kdAFMA97HQXLf4yCSQ6QfDpPG4GpiZE0/m4w7SFsEsctxbKpWJQWCImYjKcTmTSerbg8j4V81qDDlp7285Exyit7aP/IdRCC2e/3byLZOQWnGf9SlPn0+9y8XxY0mqD+/byR6vfyuW4m52k78/PcvKzOGwGpnBGlcRWb/nvAXEwni97qwYBNEouHjBb8NZEkQ83d1R7HHVLO+KleLhgx8JP45W8ouYupvZj+JTDP02k/SQDif+Pd9uk7aSO/6q3mg8ay/t2skZ/kz6oQWGDmvs6z/HZ23l8G05nS/55KAspYqCnHkpl4Ombkq0/T1Wq5WNi+z/wRiYxljI9gLv4imP3eJ6R5DqYKTp8njXyaAwQYJXPkMzBrfyeY4KiFfwiYQ386gFUC9gn1JnXal5ZAl28vuvYQiifMQhuQuvVCLHXNZvvO4kfRzQjM3rco8zlMOvhWZnsjTAL6vwaz8EFc/v8Dc+AM/XEuCaMzJXGSRAy6bAIcvQQoB4PpdAoYcQHA5Qx7i9W4HM+mJV6NY6HlGnVMMZn+JZnZ+y5lfj87T8jyL8jMG3mzn4GZ/206+38MTNux6S6IKA0UGidctZW/uE5DwBw9f1UFhimxQGG0JPNjfzB0JsO/izK/A+bT92tOfg7m3b8QzP4AZknkIsS2RAYWZra+cgY3Zh0O+8NVlRZLJpbIMj2ovrJdWJnD/wib/Q+C+V1t9h8F5qC/qhnpWOQtSCZi2XQGEIG7fjQelzBL6SyKZ9JMBo3l6r497Tt/I5j/EMos3f0bKXOwcIux0EVIiZlKZ43ayhn2F45za9qJ6/j1vDj1sqUn2qmSevmfBPP3NWB/A5u9SoMuFv8NYPqP2Vg8E4EZS2ZjJXfiSPL7DTbLeezVuIH78fDk+rYLJjthDvwJ7S9/zHA5/E+A+euHYIorT7n2PifMfyyYXYpAI3QEJIBlBjrNYmTT+36V5zEa2o7PatCeI1ULvm1Pp9jGX3CWQWl//muGtm9/AWbnCs/PwPwio11ef/2UMu/v7ysV4CiQ/fvY7MK9MzJRbkHMyGRjtRWzYp2pbV9HIP2VK2Pld/v2wB0AN8hW4rk4HeO6PhRfZrxPrs8fLd0x9jqfgelG5ezuh8Ih4vl0Y5yg5P+Neq32UP8dZVY/jrKgVK7c6wFM7xSixUs4Ad8/FkzqstnIERBLpGKFjn/bbHT8cVX+nlL1EQyWKWDX1svCXj2VIEkHqpRkcgXmcnyXr7q2MxInwzWYA7fGmyWXqL5cFA4JmNUTSRQLpcdbYNaK+Ww2VyjXG9pl8A3KJEO9bzY1TdKfflchptwkmGpQFRO+4QL6Gs3/KJiPiVTilPWTSMWrq8Un9QR+Vfy2lK0lsGLw2w/HTMYFwyi6zmQ6WVynSQ8HTDIyGr59A8wu6LKeiOkkhli83htf8Vm1V1RuyoXy80dttgzxn2K+b6FW/w5lhoIRWJUFQPOcJivRJmxTx11yXQVk4bf9Df5zYD4YGSMZP82Ze/L7i9vybnWXzmbjsSRrD+/GNmufr+qHBpgul8vU/YGLXdcy1/bLyVwW1szyFmV2h7VkLhOTpyWWaPReLittX+pZOp1iMIl4gFF9/kCZ1WyaRlacyfr1K3fejRqweyG9UOdR78TPNM/5rEK5qTeF4c5yRZ0Shjc/o8vMfxbMaiwTZXkZsTTJano71Oys7mDE5PL5eEzMl+5yMrxMtRw6bjGdzcQxB+jYuYpyLugEziXqNykTYE5qRjadV3y2dkGXqgqsSvYK+Z6SXivXbBa6TxGzF6rVQgZ/Rf1z3+yDFpDkptJgBihV7iJGehdSqQJQk+lJmkagAlHpJiOYnsGZ/3FPg78K5rR0AWbGKH9WFORMoStlE/Xx+PEunk0V3cl0ubiMZPb9RjID0kmClS6ca3XYJph05t4Ec9Bza9hbPVOArkqnx89P40Yhnk7Vo2yDCzZbz6dSuQfAWs7lyh/YrOApuQWab2rNVGBqtkRonuyRYoSpQlTTr9rSbLVCGasB1aASU8kt+P/EZt27WCoeRZxjmfiDP7iZpg62CcrMxBs+FKFiLJV7Wk6cC7m4HNqYLUuyLa0WEwcK0lXlkv8FmL0OwMwYVbfT/axBBQTnUyGeSTWez6Jg52BCAtRYPFQLReavMzZLA6RYjDin0m+4JS9UKhi1miEtnizNM0wVfGV9fivEtKIwlY/4XMKUfwVMMQUYp1qylAvaIu/y4jtgjotG6tR4KJlJNGA63H42htMyKLex6lGRySXopAf5hSnNw9Fi6D9mM8lCIZkmyTvXAnUyAJjZ+G0w8TLVYJ4Kp89FpjI0nwog/PrNBhWNRhFsIVeqPpwCYCcw64LRmbGoKFKhodikZrwRpB+EaVMruFp0Cufl4a2QTBWJKlBLGlEFZiqT+DaYsAnJHMXewz20pwBzYn8LzEI8lcicMtXpe7eXt1PQwWZzBNNelWO57JM/goW5jLJgaZdAJhr1mpGLlVeDheNcl/IycCqUKUbntcwUyszzht/VP9BlBKaRTtQ/6TZSTaSzUHmBZ0MiYPUzyoxkY+QQKEaWpYK0pJK1NJWqbRF31VJSQ9oK9SG1V5GpIK3AVjpTqxQPOzplU6lMNpHUuXLx2JdgOovhlCUGQzZJ6lPJnE4+lLh/AqZxCebTZ2AuR1SAEo3Vyq3n0qn8WMCcRH6+BdPCstn8eJxLMzLWn1zrUQsN5mLIaPctMFMp2h+xWH58xWdDD9ATf+5NMOn9KeegwmWy8WypLnCeUSbUGVO0HdOM3AERoqEqpPnuGcqaEjWkIZWGcvNEqCEvbrYU0K3W7PWVNfAhmwWauM3xZDxjJBJfU+Zi6E7siTNYMr/Dd6Y2CHOx/C6YJzYrqbQXntbzvNvVnZHO3lXLhQQVpdVg6ExDr8ECz49wX6PsLgkZrNXp5HMwb2mzBDOjwCz+OZh0GjzWSvmskcilxDQR4qyHtSaAUck5omBqy+PCU1c+6TuRdqRJUatHl0N5FhR6WpqSJpuzZuv1dXYCk1hms2CzqWw2TTzjvwFzOvGd/kIc4A+P4xX47sKdfksBgi4TO4GZgMz8pOhyIpSZjUuvBdbQT2lKLk5ggjCTGZipq6dchg7e0QfnrgZzADBBmzfATMcKtOWrjx+U2d+DKdbJYx144pHLhpw2AtObzy2z2Xp7e3ttkUjPINVOu+KlDRLui6Srko3Uo/gSKUOagOUUfJy9zkCVM4xXaTWSFarMSsyQTSEK8eQt0jxXgAAevW1MiDSyhZo7HdjXrrbPtdkTC09mKdI+AXOCYzMptvMzjALUH+ZxRU4gZ8ka+2w8BzAq+VgOpPkhHhpRJrPZF7dlZnXFNNrez8Csi6e9Xoil46XLVMtac+5Z8/l98/UVaEo2tDh32J5Uu+wuiTQSpSGVhpAq5lo761qqFB9xLLRfQZBtstjXiDKFLjMZAaZkNq2SLnj+nDKd6WA5vqPzI8MiLnrbFt+SmaKhnrZlcTeHk0/AnMLOpPsnX6yOGb2moF6ElSOLKXSpbCqjRS+k5uIzmWnL+ARM98sQ2Bcy87Fxly8+PDZ+PdIAKjWuwLS8rWe1AOYrwFSjNqPWgv+ERpVEPFN47z6HtKVFY00pr/jvvtXGpplQ5Kv3ds5m8S9hJPKlimm12+1XKx/L/EZmTm0XkLP7UyaTprfNd77FZqGYZi/AvINW84mhCjabSz6MX9jdyV5OHXsYaVmTSdevx9PpWJz507FYCgbr6rpAzFZgrpYSPxt+QpkqMCMtnW6C+ak2W6UzstxoSAZhqSFM9sRm53Nva1r3M4JZq9aqxOh1Q64LtnsfOWFLV8rRpVFSFrDvIkeDbMVHIcVWs0UI3942m7eZKEBJ8ejF49l8CUDOFNRe6Vb/vHMwF86qbmSjtgM5STS/DiyLtnMCjvWZS/YfiSVOMtOAsLMdyLTJtWVBBSiWhUzFsEewfZZs4BaB6bhFIxvLqZZV+WzKKEJqXmIpToNksVQqlUvV8fIjmLFspqDaJteuoyYnMD+zMx+rcemdcZfPiMysX7rz2p7leU0F5gP4bIs0+sY7v9k0ldjDC/2yiu2GQeq7M03o5CcSkLmt1SLrfn1VSLVkOoplATOTS8UT+SJJctZuK6p99SpG9mswcS/vwNsipZS2wUcw3ROYunJ66TcSUaIBs5/T8Qe/D4TogXCuPEDTu2Qu21j1F5KFsGQSZqixTmz/kfZUQ7ik+0hJ8Xj1C6auX07BElTWVnm6kPznU9RkUktmM2FkpNZ76dwEM5XKfQJmIw+7hJ72tPhmdQwsBPO+CQ1IaOjt7Z5C80EJUOLZUqQHyjq3FkW9KUdBsHOxqfbTw/Aq9KihbDU3WwWm4IanG8y1SebaJpavs/mrN5uZ8a/Z7GTgP4Mzp8456Kp/C8zkNZjj/HkPg1QyVnTtyS1P+2QAlpw2Hv3BdMSQtLOwT3g7NjhD2rhbObCMFv6K7oXHqyJ5gFllgIuNotKxu2swO8O6Cn+xEVms6r7cVICKsViu8YlpIv2LoP4zBNbQ1QknMNUQMGdaVLY0cbaabUo80XXfPK/dNE/mf+U8o6SoPX8CPolvRhoU5Gbg2a+vijCVyJyVqe9gKKJUKi4o1Mrf6Gx5BiZd3LFsiGUSwgsi60O/gfNi27CngQ3bJBs7FW0a9L4OwEAXo0t/u4OH4amQK7uODRbL3pf94XBiO1EjGLecZQc3Z4qBI7Pl65ZRYLPjuzC2UATUw0vfbHdcjkIP5efb2uxzLZ8rP33iznuslwu5RDabL9cbv65rTTTJkbtSvrUEBE2aoEzP80xFqhuWi268tnLShUQqlKhAJZxN0LA2QKKx3cmZIWXiGm2rZWlZKZxYEei89DWYC9uvnapAEokEq2Dta230ogxeg9mHpZ8NK9+huCSyRtGlo1Vb9hdZH/74yV1SmA4GC4rOSe8socd3n2B7OhC4I5pJOPJKk1osp36UGOJeKUCDy7SRz0yT5+dG4+n5EzDpY3+QDpzSC/FCm602hQ0qL81sdgYDwaTd2aZGBBwg9rYygOisde6jU4TK8wGMehVLR9OcgKnQBHJtq2lFclLzYfnenld+B6Y0UouHTrmElNpdeWAGADN2AjOejMHCH/iNbCYEM56GwM4YtVWfbvoPYPYHS5+VCkwGGrPtx9R3BmGy1wSEN+zaUza0tW12tJ1e2atD14VluvT9Jf4N+1eZBt3eWZFmVxX0dT5L6Lppmghxyv9As16/KE9QXJUGvUZHvoVwAsy52IncJDpMCCiweZuH58h57VdPoUdd5u1NKTsywpOELkGW+omZnY25EKeZNeJfgCkWeyYSrDExMa7UWWqz+ShBhI226MZZLMenWqB4IgWhk849rXqjDz1IJxJrm9pLtjkt52EN5+/qrm5QsXCWENyjJbsKLybT4WTKKvdLylzaC2hMQ3lhee6NVMvPe3qfwHz6LAn6PNNS+X9ObPa+aZqmcuPM2q2QgypbAraJ2VaqT+sE5jmiW+8+egSUpy48TsCcRST+pjmslpLt2UnRDYnTarWsG+2gz6MmzNeImnfB0MvG8h1/4TP9dSLF0bBE+6tG/OR8kC5bMEN64LNhRntcfPpJWhU2+wxDMlLVOQm9RdTmNIbHAooM7NnBgk2HdRPaieokPRxNpPH04qL9M91FE7rk6cyzR9Jvv9//TnnmZe/gP0mbPVEm/T1NPVqh1S+u8VlbNBqgLWBqXnkO6Zs2Q8WknIkpqY4R9BSWM+GuWi4qKGcXUJIsqQ9Zc+mtFbWH+BgC8xsnMBPxWCadkMqBodxnBscmU9rsZ2ACtILrQHV6yqWvii7ZRGQw9IVlRqnQEpiZ4rEZF6H8Z9jDFM9DcTwZQPtl99gpCU6G6sF+PYYDvkz0joEafb2iSZQ4+3MwLzLaG5cy8749n7dNszV7A5PURKaDKPdno6Woa3M9Xpt0BooKTNwUwhrLcISEF2I5OxeUWo+1sHvmVfLpFHt9xD/JNAAk2aj9ALNAsjAxeHdhL4oJAZvQH+fiqUwiEpop4861XXu0Kml3w6npM2mzLzmx08j9OiSuMDuoRSXjdBbHkkl6J0hpOIwa0eIPF0/g6iajPuN2XRlf1g59Iw368ZPyhFodRqYFNAQt+gxqOknrAtHmmW6quaYC9w2nN9te616DqUn3LQJTUSQMnNbMe73EUH/TxiapugI1NH7V0+4cTJGHkXITSyXToscIm3WnsrQPCTOVDOeIZwAmlCSonzD3r1y/2axReFo5fYa4IycPuS4rEwoGQ8DSsDSWzKRzY7/LhGn3LwyA9tUCX9Ld+/mz5OfHqwW/6ipdtn7uzqs1m/MgAJoCZl15ZqHLaF57AlSE4utHSFsgbI8eJODtvW602vqm0RRLh1YI0PIi9CI829RsZ69zIgnO8Gax11Lm8xygibMqRU5WafmSYrkdM+TEI+66kJjZcG0NAdNIxR8k76ovSV0XPUSwN1dz/ZE7hPraD5v9Lvr+qpFnv6CEdLChgZ81Gv4QRohfLRRPq7j86Sj87SOvYmAhmzXBZrdz02qGYNYe7htjRV6vNClNheh9aLuIQz5C1JuDNOdBs60oM1J4cTL0KZ5ptSPiO9Gh+tziTpxfmSkz5rVtVthlIPkZm51AnY1nz5zoRjKRzlRdf+EOnEWvbzv+Yx4mSyqyQmCb0DIhmJCayUvSjMdTaeOuQYf6YODI0hWQbTBIqolYMp5KJSJnUzbOkrHFALz6HzXi5ca5B6hmee12MG+KWwDcEmy2qfQYpe1E2tAJ0TPbBYh5zfbcs9onmUm6pB0qcjBCkFZKu6WR5ItlYZ55u1kpJgzz9bVNMGeelf0KTMcFIqfsDzZWTyY1Hj7zD8a1PNSWRCrKP0mxEMEBC2buTtVIXTatTCWzOSNxVx9zPZOl43CKlcyR4c5kkvPQpZ8GN3fxuKxKyVwmlfnZSH1xZiKRkAZEpy1J+R9i4qthlBsXjna6Zj1LO/CAxxjS7UzVEd1Gp31o/6zkQwuiOAHEZbVBmmCzM8pM0KQ3E9ZqtULVVWEHsSkkKZBSd52BJotZI5YzSmLVkA/Towd99hOnwchlUkeKGq8kwdLkjGUyRqJYa4zHT41q0YjpRj/qeUimxUk0hUy0bdqaTGhInHXoSsTZEDpfrj+Nw9YxeTpNM0L39OWL4GV8sgfz0i8B59jfTV/KU2tc9maMZzLx342kUOav8xwgyRu5FyEYuvEiLLdNU9kqTUbFPG+uw1uho2AGPgxOSX6qBKlHa1UoMtRjSb6Qjc3miUzFLWuZJbbrAtfMVxSRk5RhnCS+SBsZ+I1EJimi8PSnU8FN5KThV5jopxVipbr0xckz6dMNRKxjV01Ik5SKTFgrSg5D5nzthiS7WsA6efL7U5tsFlpU/J/CZa/BrAkoQFQRppKJZ3CKd5a2h5DrbrcD7ZH0JECio52SaiJOAwLZCl11r9qF3m7RExvKTlCoNSOS+YSRybEw2Wx7cwEcRD4zjfSnYLKt4MIt4m8AT4pKZ5OSq5aVoFDmOuySlZDnUBXA9iWsGbvqTppJxEHAUvsRi0sL/nOiSVNyZmJcgsGZ9P7xYNJNIBprs9WaXaqqCsxma95SluZmx8VVFKIiF0OdFwiKA0mpNmcWZpsMl/5dSE2CJURJJLOJTC5lZIsVS1ssAFiwzl+KzIsQGMwGkBcYEIstE2c0GIvBkEhkPnR3TjPlqq96EXCdMHb8Tl7ZPoAxqRJYuJAn+fCFZwGMIJVONPzFxBn908F8qEu6q2RxhZ68M1MSYN7PhPxaEWVyhJCCSmeK8zbDfIEzR4EYJqECSzHJr56ZTyS4alSiUKHbKPTwqTEvGpeemnMFyLZH0jKWVVQRZcap5qgYYewSCCpHD6vFacWh/nJcBGO/MmSTeAzi8Qx7rxnXPYVh+qTT9BlA+1ou+v90ynwgWZrNqKjgXrIilVWpgmAzUYFE3Q3p8gTobuuZEglrafEorFW5CVqhB6+tfTz08kCs5iHeEvmSeYIwcvYxcpKJfwqmM5m40psSxHQuHYEm/ufyFfGLFutGadUfnqLQtnh2rtIZeGIMWjEbzyY+5Adm6f+5c5lxObSH/3TKrDVVqqUyC898syBGwNMKy2ubOqK5jaImgmezqmtOmid/a9sCqYcBSyqvmibn3hvtz3nBYOqPUnI11YZGzKtZSCZin5gmU2a1O9Rj2KgweWpOqRw1caloPDszEyuwhfOp6M4BbZ1FO0/uW0NprVx36ErRBAc2iuOl7UzpUv/Hg0mzfa4VILE51GjeX47mmZobAbr1xE4RLcjzXrW62rKaVivyDAh/hdz1JFmBTqFSxRKQLZGjsl+xWs/bVIzcpwoQ/deOM3GYukonLssa4nExBGNkvNLTWTV6pkGZTuYe6fyZTE+ZkkObHvRMLC2Nn3VETM1xLUj5L8HsKTwR7pCle84/XZt9eLDmQTC3oK0Czma1eq9iKGIkts7MkNalU1ZD6kVRk3vtDRAbMxSULYESVom3gRKsckbaF1JUjfa8rTjwW5OteuNflvQ5E8azQERcUi+euGaaXH0G1C0hlaukEnBp216N7+LZNPt5k1PHPu3OnoDFksimmZ3bj9Iw/+mUaXnznaVSLRmDjOBr6tjyWUxsdo6nQlSDyZDnLJKTZ1CB4bY9lTcS+tmJZqsd6rZClnOr/frmSeZQ5Sq68RHMpdtdVWEzSBvn2NWdlc5N3AEDsfYhQWg6sf2B61ZhFaUgUpl0dbPAJUzmTBvZqusPwo4k/3ww77353Gsrypu16NUZMw+IEDabOiHoLBHhQtkFLStDk2C2563IydMSgqRr1tsqtVe5a7UnSJsoKqfrtQ1TxVRm6eurN8/Fvm7rzTzWVS0RE2Z5ZWfEmeMYpyfMSNRWH/IIGMOycXaDHju1yGL8E2jiGVJu4XG1GCzDEoR/PJjKn9dS/rxZ9b4xDp0Gb3NTBU5aUcZk6yyvQIE5a96HnQ2U40cIz2oKmNY8tGHEiFEajyJGi4KVQcy5VeGCpJUw4eTVK/5mMdSFLPjFwEYaSmjqCgI20M9mc0a+serazvUiI9PJcMmmS+NyIgbLMnHKDLqCkj3zjHx1vOoupBPtv4QyVYWmzpWVeryWhnPbUj0pmppClVsnYsSK7YaOAwhN7YWFNkX2ClkcmTEbT7sUxHdgKUHKkAmJ0jDyd5X7KJPMq/xuZdvpZLIYrsalRCydSaav/z7qpLH43dOqv7jqEOsw4WPKYHbfXz3exW+5jEJFOB0zcmU2o2WFy7+GzUoaEOF6eztPDwgzLQVnhWirHTp3ZqcKWh5gNtviIxKhKQQH5XWzjZB8ez0FSxRhEm4gCaIUf57kd4IJz8Xfbia+BpMxRyaXr+pcbC976fWJKZKquX53Ag30eskYW9o5UzNduWzfHcP519hI33ZQ5bMPXZiNEqPI9T8fzJp2/zRJZxeZBJt2U5JkoenOWpFOdJ4NwgRpmDb4zFwD8acr5TVCUojyFMdszy0mzeK5oFNPnOzt11faoPT9zeijnbXzXzeoYDjLAb9c+O5DwVDdffXIiCuhUB37bPbrXNX7TaaOLfA4INKB47uNcp6LZ6rFLzLxpFrJDXw3V2S37+FggqOXziJisz7dgbGfh03OF+hUPqvYReDE+LOpU4ly46pH+z1oRKmspnbOhmDO7lsedCOVU7LxmtfhTF2hJ/kE2KXU1/Z8E/mJhL2K/toKbRX5OGs3SZS5EsxbnB6lQ8+JqFf61prTw+HAFzyyUg2g70QiX2Z48jsrsQ0m/mpcLxeyuiGXvqOZ/F3tyV0xFf3DYph+KZ3LkDn/JJJ5Ea7UI5wqfT1p+uxwPmt0G8tKOirYmWScEwddxTNrtSbTBYhQy1T5rycwTfBWqEECJoltM2f/A/LV2XnCAUdTSLPtUXOKaFLkpIpunogT0FnFrJEomnNJip7NT6nXnjej0Mx8A0w2m7QZTH6slYuqJdhdudoAUS4HC/sbbWZwOni1P36qV/UE+eJdudYYr1b+4ubyxGSzMeOfM2Lxj2BagTdvS4zrrVkJzQ8iOgOHpQ7UpPd8o32xG8s8d8hHye8gYE9nyG52YlYqC0U72MW4lPSfV+/NiucrFnNF2mE29KtSZeWLlf0OZUoa13QwWPqrlc74dwGD3+tNvrfME9Sa6aAn+XZuOIHMYA+c25Q98evl6l8b5Z+NUjRUt1/5hFGrX4Fpzuc7moh0AbWqVVXsLAQ6g4Yq8vQ1BFP517eeZd5XLt0InqJfBcrmlEJJdSf0CAlqcpDlKbVIYUkMPc8Lc/nm57nQn4LJTGTJpRtB4xRIlkOmjk+X1Fq/s4KwiE+YL4NBf+JI04vlYthjpdDws1XjpIL2j4av35dTGbez9sJsy/H4OuHyk0alYY5e42r1hIfa3GPiiMoCkscn7LfVlh4HpioR05JQ/Hj8MFdKboSnzsdUpe5Chyp5pH2F5BsTfkD1Ki1ofl5jpMMoFwVEX1AmM5InC7Z6koYyYntA7XE+dJr8jM1yrVt3OJQ8WOYrMx/dGcGuXN6m7aUDrAeSA/vNMez3LnLZu19VJ/xxEvSv+nVJ38MDi6fnygXUkvIicQq0oqppqRt6O3nY5RPxDHP21Kn3kWYUhsCaJ++eILnxpBzlVXkWdIbQCU28zcXhUPkOmCMpSWB/bdZkTUcq5xj651K2fxNMUic0XH32Quc3Lz/pRcuFG6eTj2nsXwyd0z74rNTk5TtgflZrcg1mTdKAWpHXQDK3hBI32r2jEpwjd2yE52arU0eaIm9fRXdS6QVaTLbOlB4P+G9Js6dE6LDU9hTOZh5Qc27mUh9kJktwABz4p7NUd4lVzs5SeCrTSbhlwtqtCVeccb5xmwkNaJAnTJcKRvBC7FBlmzeGXNJZDP8goX3JBNEPeH4rnf3pO9Um9aveeTXVt0lXIJycBkCLJospkc1X78y/HuJJ9dWi96clQvP+Xgei6Tdota+QpMClnATfpUe2rclTZQrpqiLgP/c2TWbqhDl6AmYX1h5uYa/vDPrQTQYsylI3aKQ/2fr7QPbaZ3s+/RBOcb7n7PuNk6ILyJBakw8fBhcfWDZ93Wv/03773+KyX66ewLr3B12CoMA8i4mIda+LN89DJppAKWrn83ttu0jkRIHZbl8QpXdKMmlHZsplnYLy2rbnzGxv5xPpNNPVT5S5dOwh7Qj9/79nUAPim7/kmN7Qgjod9wLZMbWgm9T5dAPQD2ACzuZsJr0LrmKWLVbi4p83U7mzM+98N5RayDiIWyVv8W5qadnWnlhQmhf52t/CBFplo4iiFNUptIilp8Jgs6aZTSWVI0BTJjSSod+o/neNHxoop6bbpbta4+MqfcqyFMTO8dy0zLbHiIrYHm2aI6ypjXar2oR5S520YYR6No/csHS4eqE3iB4E7QQSJKNWBkpQQlRWCpW3V12u67FhSPwCTKe3Khv/Gxep0zGjfNVthGCq3IIQT+U/UGBCiLUl/4emiXYANUMCbXuWLjQhd96GQU1RVwGap4SrQNnWvqCQtb7O9Xs7hDJhFOavOtF2xkJNVf4TsdneqpqRLph/OqBOZf7mkcsZmdy3HHlfjpPz7uTOS1969pJ03eEfg+nK+3xR1VC+QZn3zSjwHOIpBAoW22ZQRdDVyXiW4NlWATPoOhCcqtBkN1dNaduSCfv6FmUKeXOVD9Rqhb0MzkpviSXjYKm0kbUU321bczOeTaSuwPSrRjqR5F8aV7n78sfGk/o1KRuYtM+P3Ky2Zoxcgd+wOxlXZybVYeHZ6k0dTX/72Q61V18vHl46YxgFfV5Sb0+qCcPDePtlwmja5Ol8vskFBc9UtA/XZqQgiVshJSZSX5GU/EEJ5qiFnA15BnC/0qlMotqo3wLzVBU0m0V4tu6VPiv+Wp1beUagqjahHeZhKj4rubNvp94H3skOCfNqVWFfyGBZpgCmmiuZbXJp7pw3c/FMKn4O5qJPMFOhvRIWIKTD5Y1V5Yn26urVjtVfXwlMFjCEq5TLrtCO1cE2iYpmjNP287T2dFLy93gf1UHpXCkI0peB1Ciu+iFz4TRVOvp96neolDJJDDwLq50qZTKqYD8eRVvO5pZZ07HyLTDn0tiprTKaGbnUKqyq5xPFKMrJ24UOPVWbEKXuMSHonjLvZMDo9mph7XtYgBImybY0f80wFMarz5mhJ4y3EEsakhIiYPaXUwEzk5ROZzkQW9KQj4a88TWXNgp4LNL8yIe4UJKtKcM0sZXH4JAkP2ASMCyepyfJ4SIlUnAOWzO5aNpCRl0CpxZS6aTMnywU0kbJglDPyUyYMiMHpeWMdFL/REyUzuE1bWRwXXxLqvNlyoKRK/GUGC7JS+EsfZL8BPmAPZwLT3WhEJdpc2n+/Wk1gVEq6ZK+63VNwCwh/UyVbxmyXJ1SYGo78iLJcqccemFvPdUniPV/LU+S7N7Y/Ifp7gpKbVG+nuV0Kf5aySdw+xOFisoGIuHOpY66YmTjJzYrYErX3mB/eD8Ucvt9ySjsMYJcsN8fgkJpXzGs/TteDfMQALzgeORWE1sPODjYl+L4kksH+4Kxt2Qmdd7hcLTSwbscbRmVfSHgMuuY9nDclwK5hFHa46xwpoBfOfHB4pccf8gh4CUOxwOfGU4ZVLDXCir4QZjSCA5mEicc95Wc7C3s8PMgdXGZXIG/C0fwenucZeKPw7/DvpLEVvzUfcCqHF6OvzonR/Lv2xfi1dtgbgOrHWo+ry3dMi9sEDS7yrDcKofeTNcPKb+uin+KoUi/vKeYqi7qU+qrTqzlF0hb8te0xMKktFoHR6Vjxdw0VKD5I5hmxcyVjkfLKOGeBEfc71LlGJSOJXzHzcAhR969Y0W2VgrcuksHxyApN610tMxDIcm7Vyq94wirYpaso8mzMWnlWAgOFXzHa8Us7APuS1rHI0BR8+93Gdzt4FiweEsFzGOAmw9ceEaaXzGlCWCtAJ/xk4Ev3gv8vVbuwL343ZUA9IlJTWvP3hm7PfvX7/c7HH/ERflZnZcGmKDX/XGfyxDM/b6Ce4BfHFRuglmfe/OtaTUZOXlt6chWO+xtYDJq/XaZBC1FtfQAtdmhjRjSXaf6fGnW+qpKLl/bZ+UkyoU3F1dPibU64DfS1/JUaiQy08yn4snUTTBLYFBBwDv0HpjBLsctAqZ1LBkVCw867oSBO2FYFYDJrRYQAroEE7fjQMJUM4GgAIQ62jRDMPeFytHCU2OCAwiYxj7ADQV+nH8PhPgkAYS9pcEEOfGpwhn8eghMMoR9YO3k5ltJax8cCoXj3qoAH9l7DMCpwaLJICrAypCzsRPUGfBvsSycZ+6DdzASXgRsA3+JAtO0cniyrNJtNltj0xBvbkoYLNJlN9BDVWhEufS8q6T2DfsOe8wdYKsKWpTSNy/ynCuKjOjxVFRCjffNq0Bry1fMMyT1AbiQlUjpjofXYB73Ryu5t4BP4Z3sLcctvP0l650CCHcRdxM3gPWCBBNbcRv2ZkDWmEknCwdQQlrNtC+UjuSjAFOOtjIE86jYGI7PgNmBHRYOQAqsWOYHmO9WrvRuWYF12Gsw8d2UMwTMA+jUCszjPgBNV4Q1A3yjRNYPNkuebe2PB7bOJX8xWHzGsyvguPsAJwJM/G2mnGfhiml59t7BbslmeSQnwJS3KFNysuamyqBkRs8scqwDspbq/MRUAu+sdnO7ZUfwuQfa9XSJWDsqBmvPPeUWaJ8yn6PEET4Wr6+mAVGp2Kun9SIN5dtrm+Xst9ksNIPSkYIO95RcClt2e6NyAGPjn6jAhWhM8laAV2IrYNiD7o4kgSQfdObVBpSOBo7ARUA3+sYJZQrxg1gprvhkWMfD+1HNvxPKDHBcxQIwRwETPyTgeUpl5Vc+U2TtmB+IgltSTpo5yDsQH/aaJT46pMgcRSEplJv51IDvg0GLuFDnGXIGP+7TQpn8WjJJ47fBDNvFnHztJzfQdhvl4VExmqueMYQTOvCcpbjKqbAVp19TNeA669sUFiqEWL6+MRCNJ8a0ojJATblzqsIqC6WSVW3vr8E88N5DTOLxxpMP8YItuM2gQTzzuH0gEzLc0nEXUBCaait1Hnw3aILj7gqYRz4KJU4ir3g6cOh+n+ElMsnguAOPPQh3xQeTNIWDgjSoGG8iIylGhTK5w5AzqABxSnBJITrgDUUIvw8yGNvBSaBdgfqOAWQ2i7T5ZFBm4rnYU1iALMlljjxEBCMuf9jtrQM/kvpzcqQcYBnV+g0wyUgpGrW4PC9AEBe6qupT/WRDj99GsVnPat1LMjyMT2q2WkRqx5zuYaDax2j++iY6bkunGRD5tna+mxXI7LZSgwqqAlPbmQrMDBTEXCZpmXi2oU1gQPwEmUJgFqBOYgP4HZTPQgB1JcBLtDVjVXBUSUzzwMJbNm4GIBRLT1LhC/hgEBTivEQuaXIHFJYM9AzMYliWmgkf4uChQM20ksnATObinMPM6DPiSTVlyUryUFymFMe5mLtQ4vk57rU4Q8WgAZvDhemGsNT1CoUAf0KhIt9MOa/EXZwCfybYhzoyhY9mKn7LzjSZ0qUSLsU/cAnnRqu10HNe2y2VMDIjdTZp0LBB1+xtphZJMFXkRNFlO8qxjNyy7GCh/Ostq33Si1TtkFlM5GfKPdtuv+pc6JPTYKWcBtIpiA0MtGVthAWdGW1yZ3J4yYVb0rofkHyhlyUtb/HTedGpocNBvH+neCoHrxcdpGz3tJogLAPUZ8dPVYEsGpbC4TiN0MileuaNMELvjnGe932eo587bc/mzv5M9Zq+bZqQX1J8tXSDysv6oKbJlEu1XsYbU/TE5T7zmveWJCnct99aUQFRU6uyWtc59f1hYrR0fHqdnZfXEkhQqWUWEvG0YYbM+dWM3wAzkctlYukcHZg52uR0A6RjSWo0+D8nr8mkHIAv+gOPyqX1abItyR5q4Uk5tS8X4y45NK3O4nxyEK+Sy6ndalMumismU8nvkDPkUHVaUs5RvyW8VjoZLlKYyyqXZE7eknohykyO1mdG1sDLcJWIaD08uoQz6VwmpX8Z9qQT1cZHR3vTCrZMt5QYc0UlU57XwjPlkl24XlXKpcq5DBsE0e+jKFOJ3rCO4byDE0BjLExErafby86ixiMCZRxPZ7bUFMtETsgb8SswuWaCdk8nVT7qjRTVr/r0pE7vySt/uNqZ+kYO7I23aLpwc+rqghmAnEqxt1AqzSzYJP9XfkXSZsqQzZde+JT8LPY7SabF2Y7nJZ3i0hEGk7aZO5sp3wCz7nmB12yLZVKXjC4CGum0AFMaGygww44Gm5MHaMY63ab2BrWVcqqzRlpaRZXwyYZ9LU7cda5qclk7ZCQy8XwJHKItee3zqC905GiXbs7ZRCLBYvV/61C/XcqCwy0XQ2e7X36l6/bmZNnETTsT7DKYi8/gzSxfZOjNJFdLtZ0VT5Bgoh164nJXnLV5H/UemXmqflpHNtklSjeiefPCtuyvUQxlZlW4iixrTs77mM50AZEGkx2Vnhv/JaP+6bhY1PTD+BjertXPl49SJz2Y7GzQ1AkDNbUGfLmieyDqUk1TORNO+VxbFUIxBfKmNm8IprhxWtZcxTC1qNTCMgyChcuZAEpyGlDlbM5mX9qWeYWWLDU9EZsd2v6/fzB3hK1Op4NTBmbnd9ldn+d11RuXq/SpJ8BUqyYotsrqV66GUCKczVPfWZ3r8xa1IQ0JFGC1mmqdqKYOg4noa7ebF1CeMn5a2pdAKKHx5SvWXDHes2CZyoWOsvOGC3vQt5kf9W8ag6se0NdZs58m5/0+NS/qBH0N5sP9qaxPJRGYXA2hVC5XTk0tTw53DaiOdBFP1ZMt6lIicpJtEq+gbGvfnupuMDdzUO1ZqhDptm11jFQxSM3JHy5T/I8bN3q0f55q+fL8h1nQN8EUL9CVUTITPMtRa+gPbQ0iPIFYk3VgoYYrIpOlltKRRLV+OlslQbRdvNIFS/estKdoz+eaKJUv6JVCM/U/MH8GJoYqCDrHs1m5u5fK2qZaXfMK8BN9tmGHhgzZFDU2ime/eSrpJ2q2r3zx4tPL5ytimswvijhnc+YjWMUzNvs/MP8UzJpu632O52vTnL22ZdusFfb5PjtC66lzy4tkK5MGPI9uQdVF+GzhC3ZBnCn9RiBuWvNTZExFx9qymtTr3Cz8ZDX4/4F5qfwKx21Fie1N2JueztB75bKaoQnSPk+XnrfnbAgFFMluPb3yxVuk9YhHSDXialvW65tmvGeuBQGyPVdeeoEy+z8w/xJl6iH98zSeTbPdknVqSGqqZbsKiFVOMTGYop6Fz3MIvtd7i9V57dbsarEENocmlGaxNJvpVW51OEX7gaDkzue0T5tFw8ikM/HbYE7+B+a3KPNkl4YFtaDMWTtcp+ZVVrxVWKpVGO91Fm2zOW9ahKLlmaYu8AoblurcLekNzbTKTN6KFnNrn3XQa1ttnXpZKeSy6VT2GkyW7HFdmMVEFoOZTEdczsSR1UrZjY1LOrEXydR2uMQe1xeZsAs0a2cn0p6CRXw2a4+GUs4ly9NwURqWeeJ1yFYUCxZoOtL8YGHLevO6of9CrTs8mfwczO6Nsr7/a8qM8DTpMWgqtwGZbtukpy/EU62yGGZdWqo/OPhsUxK2TrUkqj0pkaIBm89mragyQRUshO49+WqalVIhm0gaiWs2O13KfR/q4j1ZLIjVXEP+P5pgj+qoNhktJ44UbhJsWSRTyr4W0xFXCyL4UpRps2cFQVraXGdIWpGwCIw1e7gWHoTRdGg7Q1lmiCtGOb49xBP0YzC7XKDmPyozT86i0KknEREVgaaCG+IZZtpGjYEkTPbm0U3fPgtwhVjCduWKEOIhYK10FP6aRRkjgLJSKhVybFwX+7iyLYthF8upKo4mTcmqUVOXKzhJ7e2UCOKGk/Bkk23Lik9qJS/SHmdYsJJvIesHsWPTcOrYExy+sNUqbVK2N+UMzlIWXVzwEZhM3YmzlLWj/iKb7XwLzKe/F0wpbQGg2hXghVFrjadAGq6QoRCFdtTy3lS3LhUqiTqMzOmG4EKbgPI1jHdKU0vliVewVoB1jt18w3TgczBttlfyB1y0Byjawhidqb9YTH2fXfHAXn1Za80XwvMXXBqKn4ZhlzausSArnPYd35ksyYBtKfLkiVw4SpfbYutiseS6i/5yOlyCZjnNUmh28WeK2DWYnY76/3dgXi+5eLZS38/ADKuPgNr9/UVbGeAZLvYerdYo2XxUiUig89lZD2HqOALl3R2T43Wb4ZbuZ6kK4smLK+DA2Uw8phsDX4G5GLmAobNabzZrt7MgAeIOdztcyRBg+lN34XddlysDERKIps7AF0mrCG64xMGd7oBUt+h23B4eiT6Ib9nlWV2fVbr2UsDEC47s9iY2z+hy5bbpEIcBhL5v2z8Hs99ZrzvfYbPj8fk6fY9Pj78afwNlRniKdem9fcAzdPW1JBGrqZLhpQxQZ/9YCsoy/jdVE64TlGHJLanULMYNFgvFE4mYcZMyh8vuSi3Gudu6fdClPems2dJm3aFQ6/vd9W6/7vr2ZNl3N9ze9YfuQno7gfH2XZ667vvTZZenbVzAtFyEU+BxIWbs+TTtr+TQ3mojb6DirisFw5tVd+r+GMx+Z3M4bL7BZp92h+DxAs1g3viLYF6UEGo8z7JK5sSTNZpsuSator2WMl5AoF6UxdU0CTug1DkhsFusaJVi7cEDlNl4Ji3lF3r5p9g1mEPc99121cPTDUzXPbDFzvZwxDhse+wM7Ix3x/dtd8mFEnZHprOtu0uXjboI0LSz47G7juN3N3LabgV2iineZYoONKehaMvTqasOfdnyjbPgMTnK2G86J9tospSP8gqujH/yNXzlh+FgIk1QVBU8f8Luxb0EM8LzOfS2P40Px905mI3geGjdBLP+hWlS+7IcVPQhJtB6ocPgtSUrw1ngtrRQ2uHiYe0oacS6l8XGK+YsXGBzdoGkaEhsvZaOqYorSZRR3Z2vOkHb6926Y3e3h/12vQESfnd7fAcS+LftQkR2tgBw012OFrhp3H7cc1E3X0nGDg8+vO/cRXd9kNOOu57fOU3R8SGTaZ1MOREO3Xc22ANa6hJ99dgAdXBkCmJaR12bD0oXqvVy0F0sbVwbLNxeDkd87XfZq8juEky1OF9ns99vFJ990WR5M24SgflIaQkwt+9HRZqNX5fLoXLNBGJZVzXwEYhfsVm9VLjISZGfp/jKfN5WZX0SbNFmS1O1CJ55zbJA2ZxHbj1dCR+qPXQjVPKJbFqa2Kmqp1j8FpgLd7fpgKrwcO+3L5td1wEox8Nud8AdX/dIb7gHncXUIVrH3fYg0AKeJSwN7j3scYC7xDNwOGx3PKsbTXHAl6F0n5hyozp0ugHpA8z1ntCDvfNSak6w5K77tuouHXftLsAL1m5vjV+Ks9eDoe+uMffatYd97O4PsKsz6PW7L573QijHnjd+Bo5cnW+NjwrL8Xw+fnqCvFRgPj8+judjwPnYAIvwZHFiq90K8QSUtYZlCVn+Yu6PCTgFS9MygR5fy7UvCrXvGOWsVE49Dl5BmeSpKhjaIpKqyxd7VEDGNsuEMlzNNmwsrKqn5xLFblZgeiY/7dwYgTnpbnYdSLP9+26zW9suqHTDW9uBICJd9db7d9wDSEJf0Fg/77h5CXxGrrtw94QDD4LryPPwIsecpiDwsEDt4bB7fqh74H5B34UutMGuvQubCMTo97Y8pLc97HqOuzts1nwgAPx+bePR2YMzb7sL7ujY6z2eARf6D3YCyu0eD9Zu/Lw+7IMdHrIt4Xz25GNw2IWUOeeG3fxxjMPxeLV+zffc0ArRrLPIaR/UH+o1tcciRZqBfOTr3ip/AaZq9wVqCytyX1ueZXlzJs96HsGs6LU0mCIL6doiVc7DXlwh79WZIRrK3OdYnoEJPgmaAFUBUuis3e22wxve9f0eJNG2CzmHvxhb1l0biB9AmaQi+nXs4aILQtyPBSHovZvtygXN7d0ut3R8391zCp+L4/o49KAPXfQJ+RvRhUyFCcQHB5P6sG4due5aPTh4xXPEOU4/BsDvVzgBlyG/3nZcl7940xmLEID8HW/UBxwyBpYH9Q0clWA+PXoHtddqH5lTf2w/Kma/+6Wx1MJkV68FSqIf5kBzfzyNwwnNW2Cq5m2nBTCa0v/QM5uMlLTuuchJ+V410pOqrqaKi0TLop65hkRYkizT3wETz7jAdKC+OgR5Ecz3XW84kXv9QoF54F+7B7WEMnPdhWYEKdgl9W46CiFA24VUPeD+Uuruofp0CGbHp7egyzscHmoLVAovGEZQjRTqsjRHVyDidXn14wb79i7lMV+BDwF94XXk1aNpgydo80w634NjHwEmjgOTxwxP471i+BDsAubjGD+ZhIuP3v79fef98nC9ZrAPFJgPnEckRN0ipAFkwcGsQldiqj9+ckAO81U/jFOvC4UnjUtwTUnRA5utCNqV+7ZqhXe2TvhF4qXKxKS7J5/LpJJftOM9A3O6I/siYcKShxazEx65dccQjoeNSzG5WYugJNc8ENjDzgWtOThYaEvT4RSWaY/CEAxwoxgoTwDBTUZDfaiA2ZkCzONhDdCgSkHwTkjhABPm6HS0BPM87giZAm7NBwTHQpnaCMwgyu2YutZuTJihAgnmQO2wGb+st4QV7OL5OcDb84afn5741AmY0GDftw0LYO2ffoHyrF+PHnGyGg+KMJvAa/5Qs4J5DdMGYLBQk4LqjuRYxx9h3VWAqfk9MNm8pBLlF7BGYdO+kzVcS2Zzdlre7RpJXVFkCZbZTDJ1vTzXJ2D2YDeCfYHXwrz3SZkuCXBP5WQvwEJi4bYBBDzIe9gvJDFoK6MlqW2/Wa/xLO/XPXe72/QH6x1JyJWKnD2JwKWSpQ71eCjoekAwj+s157bZIAw8+J3Wj60YP25cQMYHIgAdU+eFXkU1DBdad1eAkL8Br+QCg8FU2Cxod/fSFS2WX587L8/40eTrIE+YmEdNmZycBtF+TgXoMIcuKxx0PxfK/DXHCbWGqLK4UL1WrzVxmSo+QwfaEcYyngGz/BWbvRhF4qmcerRYKuJ8zRcrZrQIruedLSx9UmktcajnZQ3Q71EmbrOoldAxoaiIBIXOI4JBkRjgWFIpgdTck1GCJVNCQQOiKvseEuuBZAPJKdvWnBH3W4lXOuy7m3d9KCmXsvD4thYe7S+nVK2wtTexGZET/ZnGihwOwuaTARjUa8cXrRls9HAQXavbWWgwoX6JcRKBCczGuPGbp5cXgjkOwaSAhEnyRG0W778awV4E4S+qsvMDyBG25kNNgflQM3EawXwgmHvQ5NdgXlGmeFuLVHCbMDjNYl6vhVwxpUpBwJyd9UJ8DSPSTShKIMukpJJ/2Yf8pM0u1rvemjaFy8XfKUFdeoR4I8FByS+9LjXR9+1YwBSGCcpcTITclEZApreBZjjuajB7nAKKEwShq8CUQ9+JMBBROFJ7WtMpTHYK2l6AeQ9tn4+L4rE4eG1ro3XDn8L5xO4BjxVO26GlotgsLuc9v4w3wmah01L1OYw1m53jXMVmaexurcZ4rsF8bHh7r9EkL31ogNmyrL5ZqzXAZnfvVH2IXUAw61VFmQJm9Q/AFDiLd9BhQygxSkx/Z4uCEMqwdbdiuU3GRvLZVCYrufzJb4E5BCFs1rvtHqb+Es/4tgNqHYlRsetBfpEIsJ/6Rgd/nPpMvYWRK3e3lwGq272tKUw3G/BWWBnTkZg2u/Fi6NIJf3HoRvDYEPf3/fZtvdmL2sQlFSZ4osgHDlr3wm8QAxVzrqjEwHhaCKVulK71gh+6fSaY1Ib22y1obC0K0JZyfvek9J0t7SvFZgHr+44KUPD4KGCSy24t9l94AOE1HzhPQF2nMafkx6EQlALmTynz7rTUOV/kUz4vTWrPVNhQhJLBKqrMZbPpPwNzunBXG6iZK9vudraw7Rb2Ut2+lT1ditdGjBOoGqKFHOQW+w6Mk4ndc1131dlCKRyL3SDcGeQznYZTjNyBI375nrS0I7se98hmwVYFNJoQ1BrdxYLO+tF06ER2ibCAqU03ICzeHbVsR7wT7+rXKO2I5EfTZC+69vsBrFX5EkGYogYpc4JgHnZPT4HmEQTz/agkp/yIVotVuDVLz7Nv1NTvo/5T2x9EZh5EZh5+BGYIaZFQlmB2QqF9beu1p88WHG8JlIUcK5zUEqTfB9OmCrvugTNudltXdBB1o7pQM4fiT30Xc2SqXXfiVrWHI4YiF/2Rr7TZ6QDc8Z1OvJ07HIpLiZosNGSMPgUnxGFHBKtrr8QDhDP5aPDeAksuxTEd2VyYE7jBOMLl8DSIbAa7HfAJILbks3xeQKC7jngqhDI7MDQ5116MlB2l4N6j00B0qR1l5tMeytDzo5KQ28enxw2YORQgcUXvvV+gUQjOXy1xGO8t6EBy7j6oPgDXnXBcQFrma/XnYJLHWt5bm3VHrTDD4IQlne6lQj4LLBnuSv0RmJBSEu5g9KKzgNgkaez20HFGi4U76W12e7ptYYYuOhv6RrarrjukrT+cMlK5hMK033Rxz11xwWxcB49Ef4Upeox/OYyZ2M5StC05dLGgfwfs1+/gQrQONz17Kn1pGWabut31Zg11aLVZdx0Yv7bLD8v+ZoPfNvKnnTU+gPY3K/plN2MlzN3Oy3qDb0oBGvOj8rGPN4E3ft7Mn57GngRLxl7gtSSW6bXpmm20vGDe/PX4qxVACWr8erCCAFD+qkP5mQfzOrCs1ecm/UB8rVYts1z9CZvVYBZlyXHYK6bqzq77GojqYykoVYlilp3wUn8A5mLigAd2Vuv1qtNlwgBbCg9ct7tweSMnDrTb9apLuwGWi8vDgPESQPqLJWcAS3VXXZzo29ztdhwHhDjpY6NPP9F0OuTqQlyjkcx21cOBi97aHUwWOFVf2AeZM/tI1k0BGXcHsGdGXZvLpdKR0GWH6m534kKww9DpOsO+2+32+7BtOysK4rXEpulhJ5iHDR3roaP96UlyDFRgWjvaVVxaB8AYKKGLlm+/GnSx1x5+AUvqtLXQNaud7TVBsPpTyiSXLUf9wJttT6ewa71HGGw+rDYVHvsnlMnFM4dQZrpdle/B/K6RzaQufnUAmGN3bX86ws12/CEP40E9BjgkvWsIKWsPB9L62eYkExtUuJgOgRCzhcDHAckEEE1k0aglVw/zu1zhaAoDB6K66/iTiY+r2swkIh0zuWQxmSzlok7f9pfsF70keU9dPj/OYuCOhm6v1xOnHkUqcw2kyaxQ5kvn5ToEpnMNftdslpiypuxX/aJ27OF3wenvglkoVE6LNurkdcm8ZNCzUioqKAVOkZmJb4HZhRIjAQ0GJllJxRygpVo6SLXmVm33pcgKG0dLZnbpA0fhXtxihhgdFWpcOnovz5bPI/6TPB91sKN36Q7dE56xHOl27o5ayMrR30fq9MllT++lMxlMpHP0VKLT9FYwaSSMZ1LD9U5gfpoC9HlbbzVuFwL+vrvtl1gSzlJUNhYWxHviUAeHPYOSYApp0msQ+x2Y7DYC8hhKq3u+MIg8Ul9GkxFfJmorG6lL8FgS7YYjOWM00j3Xdat8FVgO9+Jd+rsP5SRuG+qN0rg/vGZ49Kl9u+w76+auf8TkdIZ03Of/0uCbmQYC5Sk2/eJ5z3+lDoxUebl8Qu2P4Lz7nDYFzKIZJeuJ4iMNS1vksBdYhmITgKaTX4x0kpRp9xc2Bc+/b3Rl9PRbj596FzkjnT+C8vFjQd+PcPwCxWLhNPK6F6bq06+8sJGwzOqh67+/1fIYYK7++4b0Zx+r1++NL4Xn7Xrsi6KwT8aNVY3ORqWpljThsrYe1xkTL2yp8NNR+n84Mdjt4AoVRgAAAABJRU5ErkJggg==";
const SIG_LOGO_B64 = "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";

async function sendDirEmail(task, settings, truck, accessToken) {
  const dest = (task.origin_email || "").trim();
  if (!dest) {
    throw new Error("El operador no tiene correo electrónico. Edita la tarea y añade uno.");
  }
  const { datauri, filename, diNumber } = await generateDIR(task, settings, truck, {
    mode: "base64",
  });
  const pdfBase64 = datauri.split(",")[1];
  const fecha = fmtDate(task.transport_date || task.start_date || task.end_date);

  const subject = `DIR ${diNumber} · RECIPALETS TOTANA S.L.`;

  // ── Cuerpo del correo en HTML con la firma corporativa ──
  const intro = `
    <p>Buenos días,</p>
    <p>Adjuntamos el <strong>Documento de Identificación de Residuos (DIR)</strong>
       nº ${diNumber} correspondiente al traslado del día ${fecha}.</p>
    <p>Rogamos conserve una copia durante el transporte.</p>
  `;
  const firma = `
    <p style="margin:0 0 8px 0;">Atentamente</p>
    <table cellspacing="0" cellpadding="0" border="0"
           style="margin:6px 0 14px 0;border-collapse:collapse;">
      <tr>
        <td style="padding-right:14px;vertical-align:middle;">
          <img src="cid:jcp-banner" alt="JC PALETS" width="380"
               style="display:block;max-width:380px;height:auto;border:0;outline:none;" />
        </td>
        <td style="vertical-align:middle;">
          <img src="cid:jcp-logo" alt="JC PALETS - Reciclaje" width="120"
               style="display:block;max-width:120px;height:auto;border:0;outline:none;" />
        </td>
      </tr>
    </table>
    <div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222;line-height:1.4;">
      <div><strong>DPTO. MEDIO AMBIENTE</strong></div>
      <div><strong>JOAQUÍN CÁNOVAS DÍAZ</strong></div>
      <div>Recipalets Totana S.L.</div>
      <div><a href="https://www.jcpalets.com" style="color:#E86C1E;text-decoration:none;">www.jcpalets.com</a></div>
      <div>Autovía del Mediterráneo Km 609, Totana, Murcia, España</div>
      <div>CIF: B73384059</div>
      <div>Teléfono: +34 642 53 07 25</div>
    </div>
    <hr style="border:none;border-top:1px solid #ccc;margin:14px 0 8px 0;" />
    <div style="font-family:Calibri,Arial,sans-serif;font-size:8pt;color:#888;line-height:1.35;text-align:justify;">
      <strong>Aviso legal</strong>: Este correo electrónico (incluidos sus archivos adjuntos)
      contiene información sensible, patentada y/o confidencial que está destinada
      exclusivamente al destinatario. Si usted no es el destinatario previsto y ha recibido
      este correo electrónico por error, elimínelo inmediatamente de su sistema. Cualquier
      uso, difusión, distribución o reproducción de este correo electrónico y/o de sus
      archivos adjuntos está prohibido. Cualquier opinión expresada en este correo electrónico
      es la del remitente y puede que no reflejar necesariamente las opiniones de Recipalets
      Totana S.L.<br /><br />
      <strong>Legal Warning</strong>: This e-mail (including any attachments thereof) contains
      sensitive, proprietary and/or confidential information that is intended solely for the
      recipient. If you are not the intended recipient, you are hereby notified that any use,
      dissemination, distribution or reproduction of this e-mail is prohibited. If you have
      received this e-mail in error, please delete it immediately from your system. Any views
      expressed in this e-mail are those of the sender and may not necessarily reflect the
      views of Recipalets Totana S.L.
    </div>
  `;
  const bodyHtml = `<!DOCTYPE html><html><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222;">${intro}${firma}</body></html>`;

  const attachments = [
    {
      filename,
      contentType: "application/pdf",
      contentBase64: pdfBase64,
    },
    {
      filename: "jcp-banner.png",
      contentType: "image/png",
      contentBase64: SIG_BANNER_B64,
      inline: true,
      contentId: "jcp-banner",
    },
    {
      filename: "jcp-logo.png",
      contentType: "image/png",
      contentBase64: SIG_LOGO_B64,
      inline: true,
      contentId: "jcp-logo",
    },
  ];

  const res = await fetch(`${SUPABASE_URL}/functions/v1/clever-processor`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: dest,
      cc: "recipalets@jcpalets.com",
      subject,
      bodyHtml,
      attachments,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Error enviando email: ${txt}`);
  }
  return { sentTo: dest, filename };
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
      subtype: isAdmin ? null : "residuos",
      truck: isAdmin ? "T-01" : (userTruck || "T-01"),
      client: "",
      address: "",
      lat: null,
      lng: null,
      time: "",
      status: "pendiente",
      weight: "",
      order_number: "",
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
                    value={form.truck || ""}
                    onChange={(e) => set("truck", e.target.value || null)}
                    style={inp}
                  >
                    <option value="">— Sin asignar —</option>
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
                <label style={labelStyle}>Fecha de entrega</label>
                <input
                  type="date"
                  value={form.transport_date || ""}
                  onChange={(e) => set("transport_date", e.target.value)}
                  style={inp}
                />
              </div>
              <div>
                <label style={labelStyle}>Hora</label>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => set("time", e.target.value)}
                  style={inp}
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Cantidad</label>
                <input
                  value={form.quantity || ""}
                  onChange={(e) => set("quantity", e.target.value)}
                  style={inp}
                  placeholder="ej. 24 palets"
                />
              </div>
              <div>
                <label style={labelStyle}>Número de pedido</label>
                <input
                  value={form.order_number || ""}
                  onChange={(e) => set("order_number", e.target.value)}
                  style={inp}
                  placeholder="ej. PED-2026-0123"
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Peso</label>
                <input
                  value={form.weight}
                  onChange={(e) => set("weight", e.target.value)}
                  style={inp}
                  placeholder="ej. 200 kg"
                />
              </div>
              <div />
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
                <div>
                  <label style={labelStyle}>Ubicación de la recogida</label>
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
                      ✓ Ubicación guardada en el mapa · el botón "🚗 Navegar" llevará al
                      conductor hasta este punto en Google Maps.
                    </div>
                  )}
                </div>

                {/* Tipo de recogida: palets vs residuos */}
                <div>
                  <label style={labelStyle}>Tipo de recogida</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { v: "palets",   label: "📦 Palets" },
                      { v: "residuos", label: "♻ Residuos (con DIR)" },
                    ].map((opt) => {
                      const selected = (form.subtype || "residuos") === opt.v;
                      return (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => set("subtype", opt.v)}
                          style={{
                            padding: "11px 12px",
                            borderRadius: 10,
                            border: selected ? "2px solid #4F46E5" : "1px solid #1E2D3D",
                            background: selected ? "rgba(79,70,229,0.15)" : "#0D1B2A",
                            color: selected ? "#E2E8F0" : "#94A3B8",
                            cursor: "pointer",
                            fontWeight: selected ? 700 : 500,
                            fontSize: 13,
                            fontFamily: "inherit",
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* RECOGIDA DE PALETS — formato similar al de entregas */}
                {form.subtype === "palets" && (
                  <>
                    <div style={{ position: "relative" }}>
                      <label style={labelStyle}>Cliente</label>
                      <input
                        value={operatorQuery}
                        onChange={(e) => {
                          setOperatorQuery(e.target.value);
                          set("origin_name", e.target.value);
                          set("client", e.target.value);
                          setShowSuggest(true);
                        }}
                        onFocus={() => setShowSuggest(true)}
                        onBlur={() => setTimeout(() => setShowSuggest(false), 180)}
                        style={inp}
                        placeholder="Nombre del cliente o empresa"
                        autoComplete="off"
                      />
                      {showSuggest && suggestions.length > 0 && (
                        <div
                          style={{
                            position: "absolute", top: "100%", left: 0, right: 0,
                            background: "#0F1E33", border: "1px solid #1E2D3D",
                            borderRadius: 10, marginTop: 4, maxHeight: 200,
                            overflowY: "auto", zIndex: 10,
                          }}
                        >
                          {suggestions.map((op) => (
                            <div
                              key={op.id}
                              onMouseDown={(e) => { e.preventDefault(); applyOperator(op); }}
                              style={{
                                padding: "10px 12px", cursor: "pointer",
                                borderBottom: "1px solid #1E2D3D",
                                color: "#E2E8F0", fontSize: 13,
                              }}
                            >
                              <div style={{ fontWeight: 700 }}>{op.razon_social}</div>
                              <div style={{ fontSize: 11, color: "#64748B" }}>
                                {[op.cif, op.municipio].filter(Boolean).join(" · ")}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={labelStyle}>Hora</label>
                        <input
                          type="time"
                          value={form.time || ""}
                          onChange={(e) => set("time", e.target.value)}
                          style={inp}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Peso</label>
                        <input
                          value={form.weight || ""}
                          onChange={(e) => set("weight", e.target.value)}
                          style={inp}
                          placeholder="ej. 800 kg"
                        />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={labelStyle}>Cantidad / tipo de palets</label>
                        <input
                          value={form.quantity || ""}
                          onChange={(e) => set("quantity", e.target.value)}
                          style={inp}
                          placeholder="ej. 20 europalet, 5 americanos"
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Número de pedido</label>
                        <input
                          value={form.order_number || ""}
                          onChange={(e) => set("order_number", e.target.value)}
                          style={inp}
                          placeholder="ej. PED-2026-0123"
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
                        value={form.notes || ""}
                        onChange={(e) => set("notes", e.target.value)}
                        style={inp}
                        placeholder="Instrucciones especiales…"
                      />
                    </div>
                  </>
                )}

                {/* RECOGIDA DE RESIDUOS — formulario completo del DIR */}
                {form.subtype !== "palets" && (<>
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
                      onChange={(e) => {
                        const v = e.target.value;
                        // Al cambiar la fecha de transporte, las fechas
                        // de inicio y fin del traslado del DIR se
                        // copian automáticamente para no tener que
                        // teclearlas tres veces.
                        setForm((f) => ({
                          ...f,
                          transport_date: v,
                          start_date: v,
                          end_date: v,
                        }));
                      }}
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
                </>)}
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

// ── Operator Modal (alta + edición) ──────────────────────────
function OperatorModal({ onClose, onSave, onDelete, initialName, existing = null }) {
  const isEdit = !!(existing && existing.id);
  const [op, setOp] = useState(
    existing
      ? {
          id: existing.id,
          razon_social: existing.razon_social || "",
          cif: existing.cif || "",
          nima: existing.nima || "",
          nro_inscripcion: existing.nro_inscripcion || "",
          tipo_operador: existing.tipo_operador || "",
          direccion: existing.direccion || "",
          cp: existing.cp || "",
          municipio: existing.municipio || "",
          provincia: existing.provincia || "",
          telefono: existing.telefono || "",
          email: existing.email || "",
        }
      : {
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
        }
  );
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
          {isEdit ? "Editar cliente" : "Nuevo cliente"}
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
        <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            {isEdit && onDelete && (
              <button
                onClick={async () => {
                  if (!confirm(`¿Eliminar al cliente "${op.razon_social}"? Esta acción no se puede deshacer.`)) return;
                  await onDelete(op);
                  onClose();
                }}
                style={{
                  padding: "10px 16px", borderRadius: 10, border: "1px solid #7F1D1D",
                  background: "transparent", color: "#F87171", cursor: "pointer",
                  fontWeight: 600, fontSize: 13,
                }}
              >
                🗑 Eliminar
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
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
              {isEdit ? "Guardar cambios" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Operators List Modal (gestión de clientes) ───────────────
function OperatorsListModal({ operators, onClose, onSave, onDelete }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // null = lista, {} = nuevo, {...id} = editar
  const [saving, setSaving] = useState(false);

  const norm = (s) =>
    (s || "")
      .toString()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const q = norm(query.trim());
  const filtered = (operators || [])
    .filter((o) => {
      if (!q) return true;
      return [o.razon_social, o.cif, o.nima, o.municipio, o.email]
        .filter(Boolean)
        .some((s) => norm(s).includes(q));
    })
    .sort((a, b) => (a.razon_social || "").localeCompare(b.razon_social || ""));

  if (editing !== null) {
    return (
      <OperatorModal
        existing={editing.id ? editing : null}
        initialName={editing.razon_social || ""}
        onClose={() => setEditing(null)}
        onSave={async (op) => {
          if (saving) return;
          setSaving(true);
          try {
            await onSave(op);
            setEditing(null);
          } catch (e) {
            alert("No se pudo guardar: " + e.message);
          } finally {
            setSaving(false);
          }
        }}
        onDelete={async (op) => {
          try {
            await onDelete(op.id);
          } catch (e) {
            alert("No se pudo eliminar: " + e.message);
          }
        }}
      />
    );
  }

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
          padding: 20, width: "100%", maxWidth: 620, maxHeight: "90vh",
          display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#E2E8F0", flex: 1 }}>
            Clientes ({operators?.length || 0})
          </div>
          <button
            onClick={() => setEditing({})}
            style={{
              padding: "8px 14px", borderRadius: 10, border: "none",
              background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "#fff",
              cursor: "pointer", fontWeight: 700, fontSize: 13,
            }}
          >
            + Nuevo
          </button>
        </div>
        <input
          type="text"
          placeholder="🔎 Buscar por nombre, CIF, NIMA, municipio…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 10,
            border: "1px solid #1E2D3D", background: "#0F1E33", color: "#E2E8F0",
            fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
          }}
        />
        <div
          style={{
            flex: 1, overflowY: "auto", border: "1px solid #1E2D3D", borderRadius: 10,
            background: "#0D1B2A",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#64748B", fontSize: 13 }}>
              {operators?.length
                ? "Ningún cliente coincide con la búsqueda."
                : 'Aún no hay clientes. Pulsa "+ Nuevo" para añadir el primero.'}
            </div>
          ) : (
            filtered.map((op, i) => (
              <div
                key={op.id || i}
                onClick={() => setEditing(op)}
                style={{
                  padding: "12px 14px",
                  borderBottom: i < filtered.length - 1 ? "1px solid #1E2D3D" : "none",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 10,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#13243A")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#F1F5F9", fontWeight: 700, fontSize: 14 }}>
                    {op.razon_social || "(sin nombre)"}
                  </div>
                  <div style={{ color: "#64748B", fontSize: 11, marginTop: 2 }}>
                    {[op.cif, op.nima ? `NIMA ${op.nima}` : null, op.municipio, op.email]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div style={{ color: "#64748B", fontSize: 16 }}>›</div>
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 16px", borderRadius: 10, border: "1px solid #1E2D3D",
              background: "transparent", color: "#94A3B8", cursor: "pointer",
              fontWeight: 600, fontSize: 13,
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Users / Permissions Modal ────────────────────────────────
// Sólo visible para administradores. Lista todos los usuarios
// (auth.users via la columna email de profiles) y deja cambiar
// el rol (admin / conductor) y el camión asignado.
function UsersListModal({ token, trucks = [], onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await sbFetch(
          "profiles?select=id,email,role,truck_id&order=email.asc",
          {},
          token
        );
        if (alive) setUsers(data || []);
      } catch (e) {
        if (alive) setError("No se pudieron cargar los usuarios: " + e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const updateUser = async (user, changes) => {
    setSavingId(user.id);
    setError("");
    try {
      await sbFetch(
        `profiles?id=eq.${user.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(changes),
          headers: { Prefer: "return=minimal" },
        },
        token
      );
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...changes } : u)));
    } catch (e) {
      setError("No se pudo guardar: " + e.message);
    } finally {
      setSavingId(null);
    }
  };

  const inputStyle = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #1E2D3D",
    background: "#0F1E33",
    color: "#E2E8F0",
    fontSize: 12,
    fontFamily: "inherit",
    outline: "none",
  };

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
          padding: 20, width: "100%", maxWidth: 640, maxHeight: "90vh",
          display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#E2E8F0", flex: 1 }}>
            Usuarios y permisos ({users.length})
          </div>
        </div>
        {error && (
          <div
            style={{
              padding: "10px 12px", borderRadius: 10,
              background: "rgba(248,113,113,0.12)", color: "#F87171",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}
        <div
          style={{
            flex: 1, overflowY: "auto", border: "1px solid #1E2D3D",
            borderRadius: 10, background: "#0D1B2A",
          }}
        >
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "#64748B", fontSize: 13 }}>
              Cargando…
            </div>
          ) : users.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#64748B", fontSize: 13 }}>
              No hay usuarios registrados todavía.
            </div>
          ) : (
            users.map((u, i) => (
              <div
                key={u.id}
                style={{
                  padding: "14px",
                  borderBottom: i < users.length - 1 ? "1px solid #1E2D3D" : "none",
                  display: "grid",
                  gridTemplateColumns: "1fr 130px 130px",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: "#F1F5F9", fontWeight: 700, fontSize: 13,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {u.email || "(sin email)"}
                  </div>
                  <div style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>
                    {u.role === "admin" ? "Administrador" : "Conductor"}
                    {u.truck_id ? ` · ${u.truck_id}` : ""}
                  </div>
                </div>
                <select
                  value={u.role || "conductor"}
                  onChange={(e) => updateUser(u, { role: e.target.value })}
                  disabled={savingId === u.id}
                  style={inputStyle}
                >
                  <option value="conductor">Conductor</option>
                  <option value="admin">Administrador</option>
                </select>
                <select
                  value={u.truck_id || ""}
                  onChange={(e) =>
                    updateUser(u, { truck_id: e.target.value || null })
                  }
                  disabled={savingId === u.id || u.role === "admin"}
                  style={inputStyle}
                >
                  <option value="">— sin camión —</option>
                  {trucks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id} · {t.driver}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}
        </div>
        <div style={{ fontSize: 11, color: "#475569", padding: "0 4px" }}>
          Para añadir un usuario nuevo: pídele que se registre en la app o
          créalo desde Supabase → Authentication → Users. Aparecerá aquí
          automáticamente como conductor sin camión asignado.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 16px", borderRadius: 10, border: "1px solid #1E2D3D",
              background: "transparent", color: "#94A3B8", cursor: "pointer",
              fontWeight: 600, fontSize: 13,
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Captura de foto del albarán firmado ────────────────────
// Comprime la imagen antes de enviarla para que el correo no
// pese 5 MB (las fotos de móvil suelen ser enormes).
function compressImage(file, maxW = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob(
        (blob) => {
          const r = new FileReader();
          r.onload = () =>
            resolve({
              base64: r.result.split(",")[1],
              dataUrl: r.result,
              size: blob.size,
            });
          r.onerror = reject;
          r.readAsDataURL(blob);
        },
        "image/jpeg",
        quality,
      );
    };
    img.onerror = reject;
    const r = new FileReader();
    r.onload = () => (img.src = r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function PhotoCaptureModal({ task, truck, onClose, onAccept, sending = false, error = "" }) {
  const [preview, setPreview] = useState(null);
  const [base64, setBase64] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pdfName, setPdfName] = useState("");
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const { base64, dataUrl } = await compressImage(f);
      setPreview(dataUrl);
      setBase64(base64);
    } catch {
      alert("No se pudo cargar la imagen");
    } finally {
      setBusy(false);
    }
  };

  const handleRetake = () => {
    setPreview(null);
    setBase64(null);
    if (fileRef.current) fileRef.current.value = "";
    setTimeout(() => fileRef.current?.click(), 50);
  };

  const cliente = task.origin_name || task.client || "Sin cliente";
  const tipo = task.type === "recogida" ? "Recogida" : "Entrega";
  // En recogidas de palets el nombre del PDF se genera automático.
  // En entregas (y otros) se le pide al chófer que lo escriba.
  const askName = !(task.type === "recogida" && task.subtype === "palets");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(8px)",
        zIndex: 250,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={sending ? null : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0A1628",
          border: "1px solid #1E2D3D",
          borderRadius: 16,
          padding: 18,
          width: "100%",
          maxWidth: 480,
          maxHeight: "92vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "#E2E8F0", marginBottom: 4 }}>
          📷 Albarán firmado
        </div>
        <div style={{ fontSize: 12, color: "#64748B", marginBottom: 14 }}>
          {tipo} · {cliente}
          {truck && (
            <>
              {" · "}
              {truck.driver} ({truck.plate || truck.id})
            </>
          )}
        </div>

        {!preview ? (
          <div
            style={{
              border: "2px dashed #1E2D3D",
              borderRadius: 12,
              padding: "28px 16px",
              textAlign: "center",
              color: "#94A3B8",
              fontSize: 14,
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 10 }}>📷</div>
            <div style={{ marginBottom: 14 }}>
              Haz una foto al albarán firmado por el cliente.
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              style={{
                padding: "12px 22px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg,#4F46E5,#7C3AED)",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {busy ? "Cargando…" : "Abrir cámara"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFile}
              style={{ display: "none" }}
            />
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <img
              src={preview}
              alt="Preview albarán"
              style={{
                width: "100%",
                maxHeight: 360,
                objectFit: "contain",
                borderRadius: 10,
                border: "1px solid #1E2D3D",
                display: "block",
              }}
            />
            <div style={{ fontSize: 11, color: "#475569", marginTop: 6, textAlign: "center" }}>
              Revisa que se lea la firma antes de aceptar.
            </div>
            {askName && (
              <div style={{ marginTop: 12 }}>
                <label
                  style={{
                    fontSize: 11,
                    color: "#64748B",
                    fontWeight: 600,
                    marginBottom: 4,
                    display: "block",
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  Nombre del PDF
                </label>
                <input
                  value={pdfName}
                  onChange={(e) => setPdfName(e.target.value)}
                  placeholder="ej. Albarán Fripozo 27-04"
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "11px 12px",
                    borderRadius: 10,
                    border: "1px solid #1E2D3D",
                    background: "#0F1E33",
                    color: "#E2E8F0",
                    fontSize: 14,
                    fontFamily: "inherit",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
                  Se guardará como “{(pdfName.trim() || "(escribe un nombre)").replace(/\.pdf$/i, "")}.pdf”.
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(248,113,113,0.12)",
              color: "#F87171",
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <button
            onClick={onClose}
            disabled={sending}
            style={{
              padding: "11px 16px",
              borderRadius: 10,
              border: "1px solid #1E2D3D",
              background: "transparent",
              color: "#64748B",
              cursor: sending ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Cancelar
          </button>
          {preview && (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleRetake}
                disabled={sending}
                style={{
                  padding: "11px 16px",
                  borderRadius: 10,
                  border: "1px solid #1E2D3D",
                  background: "transparent",
                  color: "#94A3B8",
                  cursor: sending ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                ↻ Repetir
              </button>
              <button
                onClick={() => {
                  if (askName) {
                    const name = pdfName.trim();
                    if (!name) {
                      alert("Escribe el nombre del PDF antes de enviar.");
                      return;
                    }
                    onAccept(base64, name);
                  } else {
                    // Recogida de palets: nombre auto-generado
                    onAccept(base64, "");
                  }
                }}
                disabled={sending || (askName && !pdfName.trim())}
                style={{
                  padding: "11px 18px",
                  borderRadius: 10,
                  border: "none",
                  background:
                    sending || (askName && !pdfName.trim())
                      ? "#1E2D3D"
                      : "linear-gradient(135deg,#10B981,#059669)",
                  color: sending || (askName && !pdfName.trim()) ? "#475569" : "#fff",
                  cursor:
                    sending || (askName && !pdfName.trim()) ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {sending ? "Enviando…" : "✓ Aceptar y enviar"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Genera un PDF A4 con la foto del albarán + cabecera de datos
// y lo devuelve en base64 (sin el prefijo data:).
async function generateAlbaranPdf(task, photoBase64, truck = null, receivedBy = "") {
  await loadJsPdf();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 15;
  const W = 210 - 2 * M;        // 180

  const cliente = task.origin_name || task.client || "(sin cliente)";
  const tipo = task.type === "recogida" ? "Recogida" : "Entrega";
  const fecha = new Date().toLocaleDateString("es-ES");
  const hora = new Date().toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const cantidad = task.quantity || task.weight || "";
  const conductor = truck?.driver || "";
  const matricula = truck?.plate || "";

  // Cabecera
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("ALBARÁN FIRMADO", 105, M + 4, { align: "center" });

  // Caja de datos: filas dinámicas según los campos disponibles
  const rows = [];
  rows.push(["Tipo", `${tipo}${task.subtype === "palets" ? " (palets)" : ""}`]);
  rows.push(["Cliente", cliente]);
  if (cantidad) rows.push(["Cantidad", String(cantidad)]);
  if (task.order_number) rows.push(["Nº pedido", String(task.order_number)]);
  if (conductor || matricula) {
    rows.push([
      "Camión",
      [conductor, matricula ? `(${matricula})` : ""].filter(Boolean).join(" "),
    ]);
  }
  if (receivedBy) rows.push(["Recibido por", receivedBy]);
  rows.push(["Fecha y hora", `${fecha} ${hora}`]);

  let y = M + 10;
  const rowH = 5;
  const boxH = rows.length * rowH + 4;
  doc.setDrawColor(0);
  doc.setLineWidth(0.1);
  doc.setFillColor(245, 245, 245);
  doc.rect(M, y, W, boxH, "FD");
  const labelX = M + 3;
  const valueX = M + 32;
  rows.forEach((r, i) => {
    const yy = y + 4 + i * rowH;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`${r[0]}:`, labelX, yy);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 20, 20);
    doc.text(r[1], valueX, yy, { maxWidth: W - 35 });
  });
  y += boxH + 4;

  // Imagen del albarán: ocupa el resto de la página manteniendo proporción
  const imgX = M;
  const imgY = y;
  const maxW = W;
  const maxH = 297 - imgY - 12;        // dejar margen inferior

  // Necesitamos las dimensiones para mantener aspect ratio
  const dims = await new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.width, h: im.height });
    im.onerror = () => resolve({ w: maxW, h: maxH });
    im.src = "data:image/jpeg;base64," + photoBase64;
  });
  const ratio = Math.min(maxW / dims.w, maxH / dims.h);
  const drawW = dims.w * ratio;
  const drawH = dims.h * ratio;
  const drawX = imgX + (maxW - drawW) / 2;     // centrado horizontalmente
  doc.addImage("data:image/jpeg;base64," + photoBase64, "JPEG", drawX, imgY, drawW, drawH);

  // Pie
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text(
    "Documento generado por RECIPALETS TOTANA S.L. al marcar la tarea como completada.",
    M, 297 - 5,
  );

  const dataUri = doc.output("datauristring");
  return dataUri.split(",")[1];
}

// Envía el albarán firmado en PDF al correo configurado en Ajustes
// (settings.email) usando la misma edge function de Microsoft Graph.
async function sendDeliveryPhoto(
  task,
  photoBase64,
  recipientEmail,
  accessToken,
  truck = null,
  customName = ""
) {
  if (!recipientEmail) throw new Error("No hay correo destinatario configurado");
  const fecha = new Date().toLocaleDateString("es-ES");
  const hora = new Date().toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const cliente = task.origin_name || task.client || "(sin cliente)";
  const tipo = task.type === "recogida" ? "Recogida" : "Entrega";
  const cantidad = task.quantity || task.weight || "";
  const conductor = truck?.driver || "";
  const matricula = truck?.plate || "";
  const safeCliente = cliente
    .toString()
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase()
    .slice(0, 24);
  const stamp = new Date().toISOString().slice(0, 10);

  const pdfBase64 = await generateAlbaranPdf(task, photoBase64, truck);

  // Nombre del PDF: si el chófer ha escrito uno, lo usamos.
  // Si no, se autogenera según el tipo de tarea.
  let pdfFilename;
  if (customName && customName.trim()) {
    const cleaned = customName
      .trim()
      .replace(/\.pdf$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "_");
    pdfFilename = `${cleaned || "albaran"}.pdf`;
  } else {
    const prefix =
      task.type === "recogida" && task.subtype === "palets"
        ? "recogida_palets"
        : "albaran";
    pdfFilename = `${prefix}_${safeCliente}_${stamp}.pdf`;
  }

  const subject = `Albarán firmado · ${tipo} ${cliente} · ${fecha}`;
  const bodyHtml = `<!DOCTYPE html><html><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222;">
<p>Se adjunta el albarán firmado en PDF correspondiente a:</p>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 14px 0;">
  <tr><td style="padding:3px 14px 3px 0;color:#64748B;">Tipo</td><td><strong>${tipo}${task.subtype === "palets" ? " (palets)" : ""}</strong></td></tr>
  <tr><td style="padding:3px 14px 3px 0;color:#64748B;">Cliente</td><td><strong>${cliente}</strong></td></tr>
  ${cantidad ? `<tr><td style="padding:3px 14px 3px 0;color:#64748B;">Cantidad</td><td><strong>${cantidad}</strong></td></tr>` : ""}
  ${task.order_number ? `<tr><td style="padding:3px 14px 3px 0;color:#64748B;">Nº pedido</td><td><strong>${task.order_number}</strong></td></tr>` : ""}
  ${conductor || matricula ? `<tr><td style="padding:3px 14px 3px 0;color:#64748B;">Camión</td><td><strong>${[conductor, matricula ? `(${matricula})` : ""].filter(Boolean).join(" ")}</strong></td></tr>` : ""}
  ${task.address ? `<tr><td style="padding:3px 14px 3px 0;color:#64748B;">Dirección</td><td>${task.address}</td></tr>` : ""}
  <tr><td style="padding:3px 14px 3px 0;color:#64748B;">Fecha y hora</td><td>${fecha} ${hora}</td></tr>
</table>
<hr style="border:none;border-top:1px solid #ccc;margin:14px 0 8px 0;" />
<p style="color:#888;font-size:9pt;">Generado automáticamente por RECIPALETS TOTANA S.L. al marcar la tarea como completada.</p>
</body></html>`;

  const attachments = [
    {
      filename: pdfFilename,
      contentType: "application/pdf",
      contentBase64: pdfBase64,
    },
  ];

  const res = await fetch(`${SUPABASE_URL}/functions/v1/clever-processor`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: recipientEmail,
      subject,
      bodyHtml,
      attachments,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Error enviando email: ${txt}`);
  }
  return { sentTo: recipientEmail };
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
  const [sortBy, setSortBy] = useState("vencimiento"); // vencimiento | recientes | hora | cliente
  const [view, setView] = useState("tareas"); // tareas | ajustes
  const [settings, setSettings] = useState(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [operators, setOperators] = useState([]);
  const [showOperators, setShowOperators] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [photoTask, setPhotoTask] = useState(null);    // tarea pendiente de foto albarán
  const [photoSending, setPhotoSending] = useState(false);
  const [photoError, setPhotoError] = useState("");

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

  // Cuando sbFetch refresca el token automáticamente, sincronizamos
  // el estado de React para que las próximas llamadas usen el nuevo.
  useEffect(() => {
    const handler = (e) => {
      if (e.detail) setToken(e.detail);
    };
    window.addEventListener("fleet:token-refreshed", handler);
    return () => window.removeEventListener("fleet:token-refreshed", handler);
  }, []);

  // Estado de las notificaciones push del navegador.
  const [pushStatus, setPushStatus] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  );
  const handleEnablePush = async () => {
    if (!user?.id || !token) return;
    try {
      await enablePushNotifications(token, user.id);
      setPushStatus("granted");
      alert("Notificaciones activadas en este dispositivo. Recibirás un aviso cuando se te asigne una nueva tarea.");
    } catch (e) {
      setPushStatus(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
      alert("No se pudieron activar: " + e.message);
    }
  };

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
      const isAdminLocal = role === "admin";
      const queries = [
        sbFetch("tasks?order=created_at.desc&status=neq.completado", {}, token),
        // Las tareas completadas y los settings sólo los carga el admin.
        isAdminLocal
          ? sbFetch("tasks?order=created_at.desc&status=eq.completado", {}, token)
          : Promise.resolve([]),
        isAdminLocal
          ? sbFetch("settings?id=eq.1", {}, token).catch(() => [])
          : Promise.resolve([]),
        sbFetch("operators?order=razon_social.asc", {}, token).catch(() => []),
      ];
      const [active, done, sett, ops] = await Promise.all(queries);
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

  const deleteOperator = async (id) => {
    if (!id) return;
    await sbFetch(
      `operators?id=eq.${id}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
      token
    );
    const ops = await sbFetch("operators?order=razon_social.asc", {}, token).catch(() => []);
    setOperators(ops || []);
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
        "subtype",
        "truck",
        "client",
        "address",
        "lat",
        "lng",
        "time",
        "status",
        "weight",
        "quantity",
        "order_number",
        "position",
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
      // Sólo aplica a recogidas de RESIDUOS — las de palets no llevan DIR.
      if (form.type === "recogida" && form.subtype !== "palets" && (form.origin_nima || form.origin_nif)) {
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
      // Antes de guardar, recordamos el truck anterior (si existe)
      // para detectar cambios de asignación y notificar al chófer.
      const previousTruck = id
        ? (tasks.find((t) => t.id === id) || {}).truck || null
        : null;
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
      // Notificar al chófer si la tarea es nueva con camión, o si
      // se le ha cambiado el camión a un chófer distinto. No
      // bloquea el guardado si el correo falla.
      const newTruck = clean.truck || null;
      const shouldNotify =
        newTruck && (!id || newTruck !== previousTruck);
      if (shouldNotify) {
        notifyDriverOfTask({ ...clean, id }).catch((e) =>
          console.warn("No se pudo notificar al chófer:", e.message),
        );
      }
    } catch (e) {
      setError("Error al guardar: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  // Manda una notificación push (Web Push API) al chófer cuyo
  // camión coincide con task.truck. Usa la edge function
  // notify-push, que a su vez busca las suscripciones del
  // chófer en push_subscriptions y se las manda.
  const notifyDriverOfTask = async (task) => {
    if (!task.truck) return;
    // Buscamos el user_id del chófer por su truck_id
    const profiles = await sbFetch(
      `profiles?truck_id=eq.${encodeURIComponent(task.truck)}` +
        `&role=eq.conductor&select=id`,
      {},
      token,
    ).catch(() => []);
    const driverId = profiles?.[0]?.id;
    if (!driverId) return;
    const cliente = task.origin_name || task.client || "Sin cliente";
    const tipo = task.type === "recogida" ? "Recogida" : "Entrega";
    const subt =
      task.type === "recogida"
        ? task.subtype === "palets"
          ? " de palets"
          : " de residuos"
        : "";
    const fecha = task.transport_date ? fmtDate(task.transport_date) : "";
    const hora = task.time || "";
    const title = `📋 Nueva ${tipo.toLowerCase()}${subt}`;
    const body =
      `${cliente}` +
      (fecha ? ` · ${fecha}` : "") +
      (hora ? ` ${hora}` : "") +
      (task.address ? `\n${task.address}` : "");
    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-push`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token || SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        driverId,
        title,
        body,
        url: "/",
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt);
    }
  };

  // Mover una tarea hacia arriba o abajo dentro de su mismo día.
  // direction: -1 = subir (más prioritaria), +1 = bajar.
  const moveTask = async (task, direction) => {
    const dayKey = task.transport_date || null;
    // Tareas activas del mismo día (excluyendo completadas)
    const sameDay = tasks
      .filter((t) => (t.transport_date || null) === dayKey)
      .sort((a, b) => {
        const pa = a.position ?? 999999;
        const pb = b.position ?? 999999;
        if (pa !== pb) return pa - pb;
        return (a.time || "99:99").localeCompare(b.time || "99:99");
      });
    const idx = sameDay.findIndex((t) => t.id === task.id);
    const tgt = idx + direction;
    if (idx < 0 || tgt < 0 || tgt >= sameDay.length) return;
    // Renumeramos toda la lista (1, 2, 3…) y luego intercambiamos
    // las dos posiciones afectadas. Actualizamos sólo las que
    // tengan que cambiar para minimizar peticiones.
    const newOrder = sameDay.slice();
    [newOrder[idx], newOrder[tgt]] = [newOrder[tgt], newOrder[idx]];
    const updates = [];
    for (let i = 0; i < newOrder.length; i++) {
      const newPos = i + 1;
      if (newOrder[i].position !== newPos) {
        updates.push(
          sbFetch(
            `tasks?id=eq.${newOrder[i].id}`,
            {
              method: "PATCH",
              body: JSON.stringify({ position: newPos }),
              headers: { Prefer: "return=minimal" },
            },
            token,
          ),
        );
      }
    }
    try {
      await Promise.all(updates);
      // Refrescamos la lista localmente sin recargar todo
      setTasks((prev) =>
        prev.map((t) => {
          const inDay = newOrder.findIndex((x) => x.id === t.id);
          if (inDay === -1) return t;
          return { ...t, position: inDay + 1 };
        }),
      );
    } catch (e) {
      setError("No se pudo reordenar: " + e.message);
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
      // Buscamos la tarea (en local) para tener los datos del cliente
      const completedTask = tasks.find((t) => t.id === id);
      await loadData();
      // Notificamos a los administradores (sin esperar — si falla
      // no rompe nada). Sólo lo hace si quien completa NO es admin
      // (no tiene sentido que el admin se notifique a sí mismo).
      if (!isAdmin && completedTask) {
        notifyAdminsTaskCompleted(completedTask).catch((e) =>
          console.warn("No se pudo notificar al admin:", e.message),
        );
      }
    } catch {
      setError("Error al actualizar.");
    }
  };

  // Manda una push a TODOS los administradores avisándoles de
  // que el chófer ha completado una tarea.
  const notifyAdminsTaskCompleted = async (task) => {
    const admins = await sbFetch(
      "profiles?role=eq.admin&select=id",
      {},
      token,
    ).catch(() => []);
    if (!admins?.length) return;
    const cliente = task.origin_name || task.client || "Sin cliente";
    const tipo = task.type === "recogida" ? "Recogida" : "Entrega";
    const subt =
      task.type === "recogida"
        ? task.subtype === "palets"
          ? " de palets"
          : " de residuos"
        : "";
    const truckInfo = trucks.find((t) => t.id === task.truck);
    const conductor = truckInfo?.driver || "Un conductor";
    const title = `✅ Tarea completada por ${conductor}`;
    const body =
      `${tipo}${subt} · ${cliente}` +
      (task.transport_date ? ` · ${fmtDate(task.transport_date)}` : "");
    // Una llamada por admin (la edge function busca todas las
    // suscripciones de cada usuario y manda a cada dispositivo).
    await Promise.all(
      admins.map((a) =>
        fetch(`${SUPABASE_URL}/functions/v1/notify-push`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${token || SUPABASE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            driverId: a.id,        // reutilizamos el campo: aquí es el id del admin
            title,
            body,
            url: "/",
          }),
        }),
      ),
    );
  };

  // Atajo: abre la cámara para escanear el albarán cuando es entrega
  // o recogida de palets, y completa la tarea automáticamente al
  // aceptar la foto. Para recogidas de residuos no hace falta foto
  // (ya tienen el DIR), así que cae al markComplete normal.
  const handleCompleteTask = (task) => {
    const needsPhoto =
      task.type === "entrega" ||
      (task.type === "recogida" && task.subtype === "palets");
    if (!needsPhoto) {
      markComplete(task.id);
      return;
    }
    setPhotoError("");
    setPhotoTask(task);
  };

  const handlePhotoAccept = async (base64, customName = "") => {
    if (!photoTask) return;
    const dest =
      settings?.email ||
      "recipalets@jcpalets.com";
    const truck = trucks.find((t) => t.id === photoTask.truck) || null;
    setPhotoSending(true);
    setPhotoError("");
    try {
      await sendDeliveryPhoto(photoTask, base64, dest, token, truck, customName);
      await markComplete(photoTask.id);
      setPhotoTask(null);
    } catch (e) {
      setPhotoError(e.message || "Error al enviar la foto.");
    } finally {
      setPhotoSending(false);
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
      return (a.origin_name || a.client || "").localeCompare(b.origin_name || b.client || "");
    }
    if (sortBy === "recientes") {
      return (b.created_at || "").localeCompare(a.created_at || "");
    }
    // Vencimiento: las que tienen fecha más cercana primero. Las
    // que no tienen fecha se mandan al final. A igualdad de fecha,
    // se respeta el orden manual (campo "position"); a igualdad
    // también de position, se ordena por hora.
    const da = a.transport_date || "9999-12-31";
    const db = b.transport_date || "9999-12-31";
    if (da !== db) return da.localeCompare(db);
    const pa = a.position ?? 999999;
    const pb = b.position ?? 999999;
    if (pa !== pb) return pa - pb;
    return (a.time || "99:99").localeCompare(b.time || "99:99");
  };

  // Sólo el admin puede ver las completadas. Si un conductor cae aquí
  // por error con activeTab='completadas', forzamos las activas.
  const effectiveTab = !isAdmin ? "activas" : activeTab;
  const source = effectiveTab === "activas" ? tasks : completed;
  const filtered = source
    .filter((t) => {
      if (filterTruck === "all") return true;
      if (filterTruck === "__unassigned") return !t.truck;
      return t.truck === filterTruck;
    })
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

  if (view === "ajustes" && isAdmin) {
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
            {isAdmin && (
              <button
                onClick={() => setShowOperators(true)}
                title="Clientes"
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
                🏢
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setShowUsers(true)}
                title="Usuarios y permisos"
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
                👤
              </button>
            )}
            {isAdmin && (
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
            )}
            {pushStatus !== "granted" && pushStatus !== "unsupported" && (
              <button
                onClick={handleEnablePush}
                title="Activar notificaciones"
                style={{
                  background: "rgba(245,158,11,0.15)",
                  border: "1px solid #F59E0B",
                  color: "#F59E0B",
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  cursor: "pointer",
                  fontSize: 14,
                  fontFamily: "inherit",
                }}
              >
                🔔
              </button>
            )}
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
          {(isAdmin
            ? [
                ["activas", "Activas"],
                ["completadas", "Completadas"],
              ]
            : [["activas", "Activas"]]
          ).map(([k, l]) => (
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
            <option value="__unassigned">Sin asignar</option>
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
            <option value="vencimiento">Por vencimiento</option>
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
                    {task.position && sortBy === "vencimiento" && (
                      <span
                        style={{
                          background: "rgba(129,140,248,0.18)",
                          color: "#A5B4FC",
                          borderRadius: 8,
                          padding: "2px 7px",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                        title="Orden manual del día"
                      >
                        #{task.position}
                      </span>
                    )}
                    {(task.transport_date || task.time) && (
                      <span
                        style={{
                          marginLeft: "auto",
                          color: "#94A3B8",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {task.transport_date ? `📅 ${fmtDate(task.transport_date)}` : ""}
                        {task.transport_date && task.time ? " · " : ""}
                        {task.time ? `🕐 ${task.time}` : ""}
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
                    {task.origin_name || task.client || "Sin cliente"}
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
                    {truck ? (
                      <span style={{ color: "#475569", fontSize: 12 }}>🚛 {truck.driver}</span>
                    ) : (
                      <span style={{ color: "#F59E0B", fontSize: 12, fontWeight: 600 }}>
                        🚛 Sin asignar
                      </span>
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
                      {isAdmin && sortBy === "vencimiento" && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            marginRight: 4,
                          }}
                        >
                          <button
                            onClick={() => moveTask(task, -1)}
                            title="Subir orden (más prioritario)"
                            style={{
                              padding: "2px 10px",
                              borderRadius: 8,
                              border: "1px solid #1E2D3D",
                              background: "#0D1B2A",
                              color: "#94A3B8",
                              cursor: "pointer",
                              fontSize: 12,
                              fontWeight: 700,
                              lineHeight: 1,
                            }}
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => moveTask(task, 1)}
                            title="Bajar orden (menos prioritario)"
                            style={{
                              padding: "2px 10px",
                              borderRadius: 8,
                              border: "1px solid #1E2D3D",
                              background: "#0D1B2A",
                              color: "#94A3B8",
                              cursor: "pointer",
                              fontSize: 12,
                              fontWeight: 700,
                              lineHeight: 1,
                            }}
                          >
                            ▼
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => handleCompleteTask(task)}
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
                      {task.type === "recogida" && task.subtype !== "palets" && (<>
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
                        onClick={async () => {
                          if (!task.origin_email) {
                            setError(
                              "El cliente no tiene correo electrónico. Edita la tarea y añade uno."
                            );
                            return;
                          }
                          if (!confirm(`Enviar DIR a ${task.origin_email}?`)) return;
                          try {
                            const r = await sendDirEmail(
                              task,
                              settings,
                              trucks.find((t) => t.id === task.truck),
                              token
                            );
                            setError("");
                            alert(`DIR enviado a ${r.sentTo}`);
                          } catch (err) {
                            setError("No se pudo enviar: " + err.message);
                          }
                        }}
                        title={
                          task.origin_email
                            ? `Enviar DIR a ${task.origin_email}`
                            : "Falta email del cliente"
                        }
                        disabled={!task.origin_email}
                        style={{
                          width: 44,
                          padding: "10px",
                          borderRadius: 10,
                          border: "1px solid #1E2D3D",
                          background: "transparent",
                          color: task.origin_email ? "#34D399" : "#475569",
                          cursor: task.origin_email ? "pointer" : "not-allowed",
                          fontSize: 14,
                          fontFamily: "inherit",
                          opacity: task.origin_email ? 1 : 0.5,
                        }}
                      >
                        ✉
                      </button>
                      </>)}
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
                      {task.type === "recogida" && task.subtype !== "palets" && (<>
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
                      <button
                        onClick={async () => {
                          if (!task.origin_email) {
                            setError(
                              "El cliente no tiene correo electrónico. Edita la tarea y añade uno."
                            );
                            return;
                          }
                          if (!confirm(`Enviar DIR a ${task.origin_email} (con copia a RECIPALETS)?`))
                            return;
                          try {
                            const r = await sendDirEmail(
                              task,
                              settings,
                              trucks.find((t) => t.id === task.truck),
                              token
                            );
                            setError("");
                            alert(`DIR enviado a ${r.sentTo}`);
                          } catch (err) {
                            setError("No se pudo enviar: " + err.message);
                          }
                        }}
                        title={
                          task.origin_email
                            ? `Enviar por email a ${task.origin_email}`
                            : "Falta email del cliente"
                        }
                        disabled={!task.origin_email}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 10,
                          border: "1px solid #1E2D3D",
                          background: "transparent",
                          color: task.origin_email ? "#34D399" : "#475569",
                          cursor: task.origin_email ? "pointer" : "not-allowed",
                          fontSize: 12,
                          fontFamily: "inherit",
                          opacity: task.origin_email ? 1 : 0.5,
                        }}
                      >
                        ✉ Email
                      </button>
                      </>)}
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
      {showOperators && (
        <OperatorsListModal
          operators={operators}
          onClose={() => setShowOperators(false)}
          onSave={saveOperator}
          onDelete={deleteOperator}
        />
      )}
      {showUsers && (
        <UsersListModal
          token={token}
          trucks={trucks}
          onClose={() => setShowUsers(false)}
        />
      )}
      {photoTask && (
        <PhotoCaptureModal
          task={photoTask}
          truck={trucks.find((t) => t.id === photoTask.truck) || null}
          sending={photoSending}
          error={photoError}
          onClose={() => {
            if (photoSending) return;
            setPhotoTask(null);
            setPhotoError("");
          }}
          onAccept={handlePhotoAccept}
        />
      )}
    </div>
  );
}
