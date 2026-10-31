/** Coordinates for the cities we know. Unknown cities simply have no lat/lng. */
const CITIES: Record<string, { lat: number; lng: number }> = {
  haridwar: { lat: 29.9457, lng: 78.1642 },
  dehradun: { lat: 30.3165, lng: 78.0322 },
  rishikesh: { lat: 30.0869, lng: 78.2676 },
  delhi: { lat: 28.6139, lng: 77.209 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  pune: { lat: 18.5204, lng: 73.8567 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  chennai: { lat: 13.0827, lng: 80.2707 },
  kolkata: { lat: 22.5726, lng: 88.3639 },
  jaipur: { lat: 26.9124, lng: 75.7873 },
  chandigarh: { lat: 30.7333, lng: 76.7794 },
  lucknow: { lat: 26.8467, lng: 80.9462 },
  ahmedabad: { lat: 23.0225, lng: 72.5714 },
};

export function lookupCity(name: string): { lat: number; lng: number } | null {
  return CITIES[name.trim().toLowerCase()] ?? null;
}
