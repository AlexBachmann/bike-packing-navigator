import { Place, isSelfServiceWaschsalon } from '../../models/waypoint.model';

export interface PoiIconConfig {
  emoji: string;
  bg: string;
  label: string;
  badgeColor: string;
  description: string;
}

/**
 * Returns visual icon configuration (emoji, tailwind background class, badge label, badge color, description)
 * for a given Place.
 */
export function getPoiIconConfig(place: Place): PoiIconConfig {
  const isRecSite = /recreation site|rec site/i.test(place.name);

  if (isRecSite || place.category === 'campground') {
    return {
      emoji: '⛺',
      bg: 'bg-teal-600',
      label: isRecSite ? 'Recreation Site' : 'Campground',
      badgeColor: '#14b8a6',
      description: isRecSite
        ? '🌲 Primitive camping • Free / low-cost • Pit toilet • No showers'
        : '⛺ Outdoor camping • Tent & RV sites • Low cost'
    };
  }

  if (place.category === 'hotel') {
    const typeName = place.type
      ? place.type.charAt(0).toUpperCase() + place.type.slice(1).replace('_', ' ')
      : 'Lodging';
    return {
      emoji: '🏨',
      bg: 'bg-purple-600',
      label: typeName,
      badgeColor: '#c084fc',
      description: '🛏️ Indoor lodging • Bed, hot shower, roof & power'
    };
  }

  switch (place.category) {
    case 'town':
      return {
        emoji: '🏘️',
        bg: 'bg-emerald-600',
        label: 'Town',
        badgeColor: '#10b981',
        description: 'Resupply town with services'
      };
    case 'bike_shop':
      return {
        emoji: '🚲',
        bg: 'bg-blue-600',
        label: 'Bike Shop',
        badgeColor: '#3b82f6',
        description: 'Repairs, parts, tubes & tools'
      };
    case 'grocery':
    case 'gas_station':
      return {
        emoji: '🛒',
        bg: 'bg-amber-600',
        label: place.category === 'gas_station' ? 'Gas / Store' : 'Grocery',
        badgeColor: '#f59e0b',
        description: 'Food & water resupply'
      };
    case 'food':
      return {
        emoji: '🍽️',
        bg: 'bg-orange-600',
        label: 'Dining',
        badgeColor: '#f97316',
        description: 'Restaurant, cafe or bakery'
      };
    case 'laundromat':
    case 'laundry':
      return {
        emoji: '🧺',
        bg: 'bg-indigo-600',
        label: 'Laundry',
        badgeColor: '#6366f1',
        description: 'Laundromat & laundry services'
      };
    case 'water':
      return {
        emoji: '💧',
        bg: 'bg-cyan-600',
        label: 'Water',
        badgeColor: '#06b6d4',
        description: 'Water source / Cache'
      };
    default:
      return {
        emoji: '📍',
        bg: 'bg-slate-700',
        label: place.category,
        badgeColor: '#94a3b8',
        description: 'Checkpoint'
      };
  }
}

/**
 * Pure filter function that returns places matching the selected category filter.
 */
export function filterPlaces(places: Place[], filterCategory: string): Place[] {
  if (!places || places.length === 0) return [];
  if (filterCategory === 'all') return places;

  return places.filter((p) => {
    const isCamp = p.category === 'campground' || /recreation site|rec site/i.test(p.name);
    const isHotel = p.category === 'hotel' && !isCamp;

    if (filterCategory === 'town' && (p.category === 'town' || p.type === 'locality')) return true;
    if (filterCategory === 'bike_shop' && p.category === 'bike_shop') return true;
    if (filterCategory === 'grocery' && (p.category === 'grocery' || p.category === 'gas_station' || p.category === 'water')) return true;
    if (filterCategory === 'campground' && isCamp) return true;
    if (filterCategory === 'hotel' && isHotel) return true;
    if (filterCategory === 'laundromat' && (p.category === 'laundromat' || p.category === 'laundry')) {
      return isSelfServiceWaschsalon(p.name);
    }
    return false;
  });
}

/**
 * Builds HTML string for POI marker popup.
 */
export function createPoiPopupHtml(place: Place, iconConfig: PoiIconConfig, unit: 'miles' | 'km'): string {
  const isMiles = unit === 'miles';
  const mileText = isMiles ? `Mile ${place.route_mile.toFixed(1)}` : `KM ${place.route_km.toFixed(1)}`;
  const offRouteText = place.distance_to_trail_km > 0.1
    ? (isMiles ? `${(place.distance_to_trail_km * 0.621371).toFixed(1)} mi off route` : `${place.distance_to_trail_km.toFixed(1)} km off route`)
    : 'On Route';

  return `
    <div style="font-family: ui-monospace, SFMono-Regular, monospace; min-width: 180px; padding: 4px;">
      <div style="font-size: 10px; text-transform: uppercase; color: ${iconConfig.badgeColor}; font-weight: 700; letter-spacing: 0.05em;">
        ${iconConfig.emoji} ${iconConfig.label}
      </div>
      <div style="font-size: 13px; font-weight: 700; color: #ffffff; margin-top: 2px; line-height: 1.25;">${place.name}</div>
      ${place.town ? `<div style="font-size: 11px; color: #cbd5e1; margin-top: 1px;">in ${place.town}${place.province_state ? ', ' + place.province_state : ''}</div>` : ''}
      <div style="font-size: 10px; color: #94a3b8; margin-top: 4px; line-height: 1.25;">
        ${iconConfig.description}
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; border-top: 1px solid #334155; padding-top: 4px;">
        <span style="color: #34d399; font-weight: 600;">${mileText}</span>
        <span style="color: #94a3b8;">${offRouteText}</span>
      </div>
      <button
        onclick="window.dispatchEvent(new CustomEvent('bpn-jump-mile', { detail: ${place.route_mile} }))"
        style="width: 100%; margin-top: 8px; padding: 4px 8px; background: #10b981; color: #022c22; font-weight: 700; font-size: 11px; border: none; border-radius: 6px; cursor: pointer;"
      >
        Jump Rider Here ↳
      </button>
    </div>
  `;
}

/**
 * Creates the DOM element for a POI map marker pin.
 */
export function createPoiMarkerElement(iconConfig: PoiIconConfig): HTMLElement {
  const el = document.createElement('div');
  el.className = 'poi-pin-icon';
  el.innerHTML = `
    <div class="w-6 h-6 rounded-full ${iconConfig.bg} border border-slate-900 shadow-md flex items-center justify-center text-[11px] cursor-pointer hover:scale-125 transition-transform">
      ${iconConfig.emoji}
    </div>
  `;
  return el;
}

/**
 * Creates the DOM element for the rider map marker with pulsing halo animation.
 */
export function createRiderMarkerElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'rider-maplibre-icon';
  el.innerHTML = `
    <div class="relative flex items-center justify-center w-8 h-8 cursor-pointer">
      <div class="absolute w-7 h-7 rounded-full bg-emerald-400/40 animate-ping"></div>
      <div class="relative w-7 h-7 rounded-full bg-emerald-500 border-2 border-white shadow-lg flex items-center justify-center text-xs shadow-emerald-950">
        🚴
      </div>
    </div>
  `;
  return el;
}

/**
 * Builds HTML string for rider marker popup.
 */
export function createRiderPopupHtml(mile: number, ele: number, unit: 'miles' | 'km'): string {
  const isMiles = unit === 'miles';
  const distText = isMiles ? `Mile ${mile.toFixed(1)}` : `KM ${(mile * 1.60934).toFixed(1)}`;
  const eleText = isMiles ? `${Math.round(ele * 3.28084).toLocaleString()} ft` : `${Math.round(ele).toLocaleString()} m`;

  return `
    <div style="font-family: ui-monospace, SFMono-Regular, monospace; min-width: 140px; padding: 4px;">
      <div style="font-weight: 700; color: #34d399; font-size: 12px;">Rider Position</div>
      <div style="font-size: 13px; font-weight: 600; color: #f8fafc; margin-top: 2px;">${distText}</div>
      <div style="font-size: 11px; color: #94a3b8;">Elevation: ${eleText}</div>
    </div>
  `;
}

/**
 * Creates the DOM element for the GPS beacon map marker.
 */
export function createGpsMarkerElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'gps-maplibre-icon';
  el.innerHTML = `
    <div class="relative flex items-center justify-center w-7 h-7">
      <div class="absolute w-6 h-6 rounded-full bg-blue-500/40 animate-ping"></div>
      <div class="relative w-5 h-5 rounded-full bg-blue-500 border-2 border-white shadow-md flex items-center justify-center text-[10px]">
        📍
      </div>
    </div>
  `;
  return el;
}
