export interface MetarStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface MetarObservation {
  stationId: string;
  windDirectionDeg: number | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  timestamp: string | null;
}
