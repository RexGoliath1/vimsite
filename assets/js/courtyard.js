"use strict";
(() => {
  const DATA_BASE = "assets/data/courtyard";
  const CHICAGO_CENTER = [41.8781, -87.6298];
  const DEFAULT_ZOOM = 11;
  const TIER_COLORS = {
    "shovel-ready": "#4caf50",
    "needs-assembly": "#ff9800",
    "zoning-change-needed": "#f44336"
  };
  const TIER_DEFAULT_COLOR = "#9e9e9e";
  function initMap() {
    const mapEl = document.getElementById("courtyard-map");
    if (!mapEl) return;
    const map = L.map(mapEl, {
      center: CHICAGO_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19
    }).addTo(map);
    loadClusters(map);
    loadMetadata();
  }
  async function loadClusters(map) {
    try {
      const resp = await fetch(`${DATA_BASE}/clusters.geojson`);
      if (!resp.ok) {
        showStatus("No cluster data available yet.");
        return;
      }
      const data = await resp.json();
      renderClusters(map, data);
      updateStats(data);
    } catch {
      showStatus("Failed to load cluster data.");
    }
  }
  async function loadMetadata() {
    try {
      const resp = await fetch(`${DATA_BASE}/metadata.json`);
      if (!resp.ok) return;
      const meta = await resp.json();
      const metaEl = document.getElementById("pipeline-meta");
      if (metaEl) {
        const ts = new Date(meta.run_timestamp).toLocaleDateString();
        metaEl.textContent = `pipeline v${meta.pipeline_version} \xB7 ${ts}`;
      }
    } catch {
    }
  }
  function renderClusters(map, data) {
    const clusterLayer = L.geoJSON(data, {
      style: (feature) => {
        const tier = feature.properties.tier;
        return {
          fillColor: TIER_COLORS[tier] || TIER_DEFAULT_COLOR,
          fillOpacity: 0.6,
          color: "#39ff14",
          weight: 1,
          opacity: 0.8
        };
      },
      onEachFeature: (_feature, layer) => {
        layer.on("click", () => {
          const props = _feature.properties;
          showDetail(props);
        });
      }
    }).addTo(map);
    if (data.features.length > 0) {
      map.fitBounds(clusterLayer.getBounds(), { padding: [40, 40] });
    }
  }
  function showDetail(props) {
    const panel = document.getElementById("detail-panel");
    if (!panel) return;
    let html = `<h3>cluster #${props.cluster_id}</h3>`;
    html += '<div class="detail-section">';
    html += `<div class="detail-row"><span class="detail-label">tier</span><span class="detail-value tier-${props.tier}">${props.tier}</span></div>`;
    html += `<div class="detail-row"><span class="detail-label">lots</span><span class="detail-value">${props.lot_count}</span></div>`;
    html += `<div class="detail-row"><span class="detail-label">total sqft</span><span class="detail-value">${props.total_sqft.toLocaleString()}</span></div>`;
    html += `<div class="detail-row"><span class="detail-label">zoning</span><span class="detail-value">${props.zoning}</span></div>`;
    html += "</div>";
    if (props.nearest_station) {
      html += '<div class="detail-section">';
      html += "<h4>transit</h4>";
      html += `<div class="detail-row"><span class="detail-label">nearest station</span><span class="detail-value">${props.nearest_station}</span></div>`;
      if (props.station_distance_m) {
        html += `<div class="detail-row"><span class="detail-label">distance</span><span class="detail-value">${props.station_distance_m}m</span></div>`;
      }
      if (props.in_tsl) {
        html += '<div class="detail-row"><span class="detail-label">TSL zone</span><span class="detail-value">yes</span></div>';
      }
      html += "</div>";
    }
    if (props.in_tif || props.in_opportunity_zone || props.in_enterprise_zone || props.in_invest_sw) {
      html += '<div class="detail-section">';
      html += "<h4>incentives</h4>";
      if (props.in_tif) {
        html += `<div class="detail-row"><span class="detail-label">TIF</span><span class="detail-value">${props.tif_name || "yes"}</span></div>`;
        if (props.tif_balance) {
          html += `<div class="detail-row"><span class="detail-label">TIF balance</span><span class="detail-value">$${props.tif_balance.toLocaleString()}</span></div>`;
        }
      }
      if (props.in_opportunity_zone) {
        html += '<div class="detail-row"><span class="detail-label">opportunity zone</span><span class="detail-value">yes</span></div>';
      }
      if (props.in_enterprise_zone) {
        html += '<div class="detail-row"><span class="detail-label">enterprise zone</span><span class="detail-value">yes</span></div>';
      }
      if (props.in_invest_sw) {
        html += '<div class="detail-row"><span class="detail-label">INVEST S/W</span><span class="detail-value">yes</span></div>';
      }
      html += "</div>";
    }
    if (props.alderman || props.viability_score || props.environmental_status) {
      html += '<div class="detail-section">';
      html += "<h4>details</h4>";
      if (props.ward && props.alderman) {
        html += `<div class="detail-row"><span class="detail-label">ward ${props.ward}</span><span class="detail-value">${props.alderman}</span></div>`;
      }
      if (props.community_area) {
        html += `<div class="detail-row"><span class="detail-label">area</span><span class="detail-value">${props.community_area}</span></div>`;
      }
      if (props.viability_score) {
        html += `<div class="detail-row"><span class="detail-label">viability</span><span class="detail-value">${props.viability_score}/100</span></div>`;
      }
      if (props.environmental_status) {
        html += `<div class="detail-row"><span class="detail-label">environmental</span><span class="detail-value">${props.environmental_status}</span></div>`;
      }
      html += "</div>";
    }
    html += '<div class="detail-section">';
    html += "<h4>addresses</h4>";
    html += '<ul class="detail-addresses">';
    for (const addr of props.addresses) {
      html += `<li>${addr}</li>`;
    }
    html += "</ul>";
    html += "</div>";
    panel.innerHTML = html;
    panel.classList.add("active");
  }
  function updateStats(data) {
    const el = document.getElementById("cluster-stats");
    if (!el) return;
    const total = data.features.length;
    const totalLots = data.features.reduce((sum, f) => sum + f.properties.lot_count, 0);
    const shovelReady = data.features.filter((f) => f.properties.tier === "shovel-ready").length;
    el.textContent = `${total} clusters \xB7 ${totalLots} lots \xB7 ${shovelReady} shovel-ready`;
  }
  function showStatus(msg) {
    const el = document.getElementById("cluster-stats");
    if (el) el.textContent = msg;
  }
  document.addEventListener("DOMContentLoaded", initMap);
})();
