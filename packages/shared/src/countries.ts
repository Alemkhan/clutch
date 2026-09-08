export interface Country {
  code: string;
  name: string;
  capital: string;
  region: string;
}

export const countries: Country[] = [
  { code: 'fr', name: 'France', capital: 'Paris', region: 'Europe' },
  { code: 'de', name: 'Germany', capital: 'Berlin', region: 'Europe' },
  { code: 'it', name: 'Italy', capital: 'Rome', region: 'Europe' },
  { code: 'es', name: 'Spain', capital: 'Madrid', region: 'Europe' },
  { code: 'pt', name: 'Portugal', capital: 'Lisbon', region: 'Europe' },
  { code: 'gr', name: 'Greece', capital: 'Athens', region: 'Europe' },
  { code: 'nl', name: 'Netherlands', capital: 'Amsterdam', region: 'Europe' },
  { code: 'be', name: 'Belgium', capital: 'Brussels', region: 'Europe' },
  { code: 'ch', name: 'Switzerland', capital: 'Bern', region: 'Europe' },
  { code: 'at', name: 'Austria', capital: 'Vienna', region: 'Europe' },
  { code: 'se', name: 'Sweden', capital: 'Stockholm', region: 'Europe' },
  { code: 'no', name: 'Norway', capital: 'Oslo', region: 'Europe' },
  { code: 'dk', name: 'Denmark', capital: 'Copenhagen', region: 'Europe' },
  { code: 'fi', name: 'Finland', capital: 'Helsinki', region: 'Europe' },
  { code: 'pl', name: 'Poland', capital: 'Warsaw', region: 'Europe' },
  { code: 'ie', name: 'Ireland', capital: 'Dublin', region: 'Europe' },
  { code: 'gb', name: 'United Kingdom', capital: 'London', region: 'Europe' },
  { code: 'cz', name: 'Czech Republic', capital: 'Prague', region: 'Europe' },
  { code: 'hu', name: 'Hungary', capital: 'Budapest', region: 'Europe' },
  { code: 'hr', name: 'Croatia', capital: 'Zagreb', region: 'Europe' },
  { code: 'us', name: 'United States', capital: 'Washington, D.C.', region: 'Americas' },
  { code: 'ca', name: 'Canada', capital: 'Ottawa', region: 'Americas' },
  { code: 'br', name: 'Brazil', capital: 'Brasília', region: 'Americas' },
  { code: 'ar', name: 'Argentina', capital: 'Buenos Aires', region: 'Americas' },
  { code: 'mx', name: 'Mexico', capital: 'Mexico City', region: 'Americas' },
  { code: 'cl', name: 'Chile', capital: 'Santiago', region: 'Americas' },
  { code: 'co', name: 'Colombia', capital: 'Bogotá', region: 'Americas' },
  { code: 'pe', name: 'Peru', capital: 'Lima', region: 'Americas' },
  { code: 'jp', name: 'Japan', capital: 'Tokyo', region: 'Asia' },
  { code: 'cn', name: 'China', capital: 'Beijing', region: 'Asia' },
  { code: 'in', name: 'India', capital: 'New Delhi', region: 'Asia' },
  { code: 'kr', name: 'South Korea', capital: 'Seoul', region: 'Asia' },
  { code: 'th', name: 'Thailand', capital: 'Bangkok', region: 'Asia' },
  { code: 'vn', name: 'Vietnam', capital: 'Hanoi', region: 'Asia' },
  { code: 'id', name: 'Indonesia', capital: 'Jakarta', region: 'Asia' },
  { code: 'tr', name: 'Turkey', capital: 'Ankara', region: 'Asia' },
  { code: 'il', name: 'Israel', capital: 'Jerusalem', region: 'Asia' },
  { code: 'ae', name: 'United Arab Emirates', capital: 'Abu Dhabi', region: 'Asia' },
  { code: 'sa', name: 'Saudi Arabia', capital: 'Riyadh', region: 'Asia' },
  { code: 'eg', name: 'Egypt', capital: 'Cairo', region: 'Africa' },
  { code: 'za', name: 'South Africa', capital: 'Pretoria', region: 'Africa' },
  { code: 'ma', name: 'Morocco', capital: 'Rabat', region: 'Africa' },
  { code: 'ng', name: 'Nigeria', capital: 'Abuja', region: 'Africa' },
  { code: 'ke', name: 'Kenya', capital: 'Nairobi', region: 'Africa' },
  { code: 'et', name: 'Ethiopia', capital: 'Addis Ababa', region: 'Africa' },
  { code: 'au', name: 'Australia', capital: 'Canberra', region: 'Oceania' },
  { code: 'nz', name: 'New Zealand', capital: 'Wellington', region: 'Oceania' },
  { code: 'ru', name: 'Russia', capital: 'Moscow', region: 'Europe' },
  { code: 'is', name: 'Iceland', capital: 'Reykjavik', region: 'Europe' },
  { code: 'iq', name: 'Iraq', capital: 'Baghdad', region: 'Asia' },
  { code: 've', name: 'Venezuela', capital: 'Caracas', region: 'Americas' },
  { code: 'sz', name: 'Eswatini', capital: 'Mbabane', region: 'Africa' },
  { code: 'zm', name: 'Zambia', capital: 'Lusaka', region: 'Africa' },
  { code: 'na', name: 'Namibia', capital: 'Windhoek', region: 'Africa' },
  { code: 'am', name: 'Armenia', capital: 'Yerevan', region: 'Asia' },
  { code: 'ag', name: 'Antigua and Barbuda', capital: "St. John's", region: 'Americas' },
  { code: 'dm', name: 'Dominica', capital: 'Roseau', region: 'Americas' },
];

export function flagUrl(code: string, width: number = 320): string {
  return `https://flagcdn.com/w${width}/${code}.png`;
}

// Outline silhouettes from mapsicon (CC0-friendly, credit: djaiss/mapsicon), served via jsDelivr's GitHub CDN.
export function outlineUrl(code: string, size: 128 | 256 | 512 = 256): string {
  return `https://cdn.jsdelivr.net/gh/djaiss/mapsicon@master/all/${code}/${size}.png`;
}
