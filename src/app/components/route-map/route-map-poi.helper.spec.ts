import { describe, it, expect } from 'vitest';
import { createPoiPopupHtml, getPoiIconConfig, filterPlaces } from './route-map-poi.helper';
import { Place } from '../../models/waypoint.model';

describe('route-map-poi.helper', () => {
  const basePlace: Place = {
    id: 'test-1',
    name: 'Mesa Alta Spring & Water Catchment',
    category: 'water',
    type: 'water_point',
    town: 'Mesa Alta',
    province_state: 'NM',
    is_in_town: false,
    location: { lat: 36.5, lon: -106.8 },
    distance_to_trail_km: 0.0,
    route_km: 3452.0,
    route_mile: 2145.0,
    google_maps_url: 'https://maps.google.com/?q=36.5,-106.8'
  };

  it('should render View on Google Maps link with explicit google_maps_url', () => {
    const config = getPoiIconConfig(basePlace);
    const html = createPoiPopupHtml(basePlace, config, 'km');

    expect(html).toContain('View on Google Maps');
    expect(html).toContain('href="https://maps.google.com/?q=36.5,-106.8"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('Jump Rider Here');
  });

  it('should construct Google Maps URL from lat/lon coordinates when google_maps_url is omitted', () => {
    const placeWithoutUrl: Place = {
      ...basePlace,
      google_maps_url: undefined
    };
    const config = getPoiIconConfig(placeWithoutUrl);
    const html = createPoiPopupHtml(placeWithoutUrl, config, 'miles');

    expect(html).toContain('View on Google Maps');
    expect(html).toContain('href="https://maps.google.com/?q=36.5,-106.8"');
    expect(html).toContain('Mile 2145.0');
    expect(html).toContain('On Route');
  });

  it('should format distance and off-route text correctly for miles and km', () => {
    const offRoutePlace: Place = {
      ...basePlace,
      distance_to_trail_km: 2.5
    };
    const config = getPoiIconConfig(offRoutePlace);

    const kmHtml = createPoiPopupHtml(offRoutePlace, config, 'km');
    expect(kmHtml).toContain('KM 3452.0');
    expect(kmHtml).toContain('2.5 km off route');

    const milesHtml = createPoiPopupHtml(offRoutePlace, config, 'miles');
    expect(milesHtml).toContain('Mile 2145.0');
    expect(milesHtml).toContain('1.6 mi off route');
  });

  it('should filter places by water category correctly', () => {
    const places: Place[] = [
      { ...basePlace, id: 'water-1', category: 'water' },
      { ...basePlace, id: 'town-1', category: 'town', type: 'locality' },
      { ...basePlace, id: 'camp-1', category: 'campground' },
      { ...basePlace, id: 'water-2', category: 'water', name: 'Spring' }
    ];

    const waterResults = filterPlaces(places, 'water');
    expect(waterResults.length).toBe(2);
    expect(waterResults.map((p) => p.id)).toEqual(['water-1', 'water-2']);

    const townResults = filterPlaces(places, 'town');
    expect(townResults.length).toBe(1);
    expect(townResults[0].id).toBe('town-1');

    const allResults = filterPlaces(places, 'all');
    expect(allResults.length).toBe(4);
  });
});
