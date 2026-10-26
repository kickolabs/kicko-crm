// Each country's main international arrival airport (geography, not industry data),
// used for the case journey's route line when the case doesn't name a city.
// "ISO2|City|IATA|lat|lng"; coordinates are the airport's, rounded to 0.01°.
// Countries without an airport of their own (Andorra, Liechtenstein, Monaco, San
// Marino, Vatican) are left out: the line then shows the country name.

const DATA = `
AE|Dubai|DXB|25.25|55.36
AF|Kabul|KBL|34.57|69.21
AG|St. John's|ANU|17.14|-61.79
AL|Tirana|TIA|41.41|19.72
AM|Yerevan|EVN|40.15|44.40
AO|Luanda|LAD|-8.86|13.23
AR|Buenos Aires|EZE|-34.82|-58.54
AT|Vienna|VIE|48.11|16.57
AU|Sydney|SYD|-33.94|151.18
AZ|Baku|GYD|40.47|50.05
BA|Sarajevo|SJJ|43.82|18.33
BB|Bridgetown|BGI|13.07|-59.49
BD|Dhaka|DAC|23.84|90.40
BE|Brussels|BRU|50.90|4.48
BF|Ouagadougou|OUA|12.35|-1.51
BG|Sofia|SOF|42.70|23.41
BH|Manama|BAH|26.27|50.63
BI|Bujumbura|BJM|-3.32|29.32
BJ|Cotonou|COO|6.36|2.38
BN|Bandar Seri Begawan|BWN|4.94|114.93
BO|Santa Cruz|VVI|-17.64|-63.14
BR|São Paulo|GRU|-23.43|-46.47
BS|Nassau|NAS|25.04|-77.47
BT|Paro|PBH|27.40|89.42
BW|Gaborone|GBE|-24.56|25.92
BY|Minsk|MSQ|53.88|28.03
BZ|Belize City|BZE|17.54|-88.31
CA|Toronto|YYZ|43.68|-79.63
CD|Kinshasa|FIH|-4.39|15.44
CF|Bangui|BGF|4.40|18.52
CG|Brazzaville|BZV|-4.25|15.25
CH|Zurich|ZRH|47.46|8.55
CI|Abidjan|ABJ|5.26|-3.93
CL|Santiago|SCL|-33.39|-70.79
CM|Douala|DLA|4.01|9.72
CN|Beijing|PEK|40.08|116.58
CO|Bogotá|BOG|4.70|-74.15
CR|San José|SJO|9.99|-84.20
CU|Havana|HAV|22.99|-82.41
CV|Praia|RAI|14.92|-23.49
CY|Larnaca|LCA|34.88|33.62
CZ|Prague|PRG|50.10|14.26
DE|Frankfurt|FRA|50.04|8.56
DJ|Djibouti|JIB|11.55|43.16
DK|Copenhagen|CPH|55.62|12.66
DM|Roseau|DOM|15.55|-61.30
DO|Santo Domingo|SDQ|18.43|-69.67
DZ|Algiers|ALG|36.69|3.22
EC|Quito|UIO|-0.13|-78.36
EE|Tallinn|TLL|59.41|24.83
EG|Cairo|CAI|30.12|31.41
ER|Asmara|ASM|15.29|38.91
ES|Madrid|MAD|40.47|-3.56
ET|Addis Ababa|ADD|8.98|38.80
FI|Helsinki|HEL|60.32|24.96
FJ|Nadi|NAN|-17.76|177.44
FM|Pohnpei|PNI|6.98|158.21
FR|Paris|CDG|49.01|2.55
GA|Libreville|LBV|0.46|9.41
GB|London|LHR|51.47|-0.45
GD|St. George's|GND|12.00|-61.79
GE|Tbilisi|TBS|41.67|44.95
GH|Accra|ACC|5.61|-0.17
GM|Banjul|BJL|13.34|-16.65
GN|Conakry|CKY|9.58|-13.61
GQ|Malabo|SSG|3.76|8.71
GR|Athens|ATH|37.94|23.94
GT|Guatemala City|GUA|14.58|-90.53
GW|Bissau|OXB|11.89|-15.65
GY|Georgetown|GEO|6.50|-58.25
HK|Hong Kong|HKG|22.31|113.91
HN|San Pedro Sula|SAP|15.45|-87.92
HR|Zagreb|ZAG|45.74|16.07
HT|Port-au-Prince|PAP|18.58|-72.29
HU|Budapest|BUD|47.44|19.26
ID|Jakarta|CGK|-6.13|106.66
IE|Dublin|DUB|53.42|-6.27
IL|Tel Aviv|TLV|32.01|34.89
IQ|Baghdad|BGW|33.26|44.23
IR|Tehran|IKA|35.42|51.15
IS|Reykjavik|KEF|63.99|-22.62
IT|Rome|FCO|41.80|12.25
JM|Kingston|KIN|17.94|-76.79
JO|Amman|AMM|31.72|35.99
JP|Tokyo|HND|35.55|139.78
KE|Nairobi|NBO|-1.32|36.93
KG|Bishkek|FRU|43.06|74.48
KH|Phnom Penh|KTI|11.33|104.88
KI|Tarawa|TRW|1.38|173.15
KM|Moroni|HAH|-11.53|43.27
KN|Basseterre|SKB|17.31|-62.72
KP|Pyongyang|FNJ|39.22|125.67
KR|Seoul|ICN|37.46|126.44
KW|Kuwait City|KWI|29.24|47.97
KZ|Almaty|ALA|43.35|77.04
LA|Vientiane|VTE|17.99|102.56
LB|Beirut|BEY|33.82|35.49
LC|Vieux Fort|UVF|13.73|-60.95
LK|Colombo|CMB|7.18|79.88
LR|Monrovia|ROB|6.23|-10.36
LS|Maseru|MSU|-29.46|27.55
LT|Vilnius|VNO|54.63|25.29
LU|Luxembourg|LUX|49.63|6.21
LV|Riga|RIX|56.92|23.97
LY|Tripoli|MJI|32.89|13.28
MA|Casablanca|CMN|33.37|-7.59
MD|Chișinău|KIV|46.93|28.93
ME|Podgorica|TGD|42.36|19.25
MG|Antananarivo|TNR|-18.80|47.48
MH|Majuro|MAJ|7.06|171.27
MK|Skopje|SKP|41.96|21.62
ML|Bamako|BKO|12.53|-7.95
MM|Yangon|RGN|16.91|96.13
MN|Ulaanbaatar|UBN|47.65|106.82
MO|Macau|MFM|22.15|113.59
MR|Nouakchott|NKC|18.31|-15.97
MT|Malta|MLA|35.86|14.48
MU|Mauritius|MRU|-20.43|57.68
MV|Malé|MLE|4.19|73.53
MW|Lilongwe|LLW|-13.79|33.78
MX|Mexico City|MEX|19.44|-99.07
MY|Kuala Lumpur|KUL|2.75|101.71
MZ|Maputo|MPM|-25.92|32.57
NA|Windhoek|WDH|-22.48|17.47
NE|Niamey|NIM|13.48|2.18
NG|Lagos|LOS|6.58|3.32
NI|Managua|MGA|12.14|-86.17
NL|Amsterdam|AMS|52.31|4.76
NO|Oslo|OSL|60.19|11.10
NP|Kathmandu|KTM|27.70|85.36
NR|Nauru|INU|-0.55|166.92
NZ|Auckland|AKL|-37.01|174.79
OM|Muscat|MCT|23.59|58.28
PA|Panama City|PTY|9.07|-79.38
PE|Lima|LIM|-12.02|-77.11
PG|Port Moresby|POM|-9.44|147.22
PH|Manila|MNL|14.51|121.02
PK|Islamabad|ISB|33.55|72.83
PL|Warsaw|WAW|52.17|20.97
PR|San Juan|SJU|18.44|-66.00
PT|Lisbon|LIS|38.77|-9.13
PW|Koror|ROR|7.37|134.54
PY|Asunción|ASU|-25.24|-57.52
QA|Doha|DOH|25.27|51.61
RO|Bucharest|OTP|44.57|26.09
RS|Belgrade|BEG|44.82|20.31
RU|Moscow|SVO|55.97|37.41
RW|Kigali|KGL|-1.97|30.14
SA|Riyadh|RUH|24.96|46.70
SB|Honiara|HIR|-9.43|160.05
SC|Mahé|SEZ|-4.67|55.52
SD|Port Sudan|PZU|19.43|37.23
SE|Stockholm|ARN|59.65|17.92
SG|Singapore|SIN|1.36|103.99
SI|Ljubljana|LJU|46.22|14.46
SK|Bratislava|BTS|48.17|17.21
SL|Freetown|FNA|8.62|-13.20
SN|Dakar|DSS|14.67|-17.07
SO|Mogadishu|MGQ|2.01|45.30
SR|Paramaribo|PBM|5.45|-55.19
SS|Juba|JUB|4.87|31.60
ST|São Tomé|TMS|0.38|6.71
SV|San Salvador|SAL|13.44|-89.06
SY|Damascus|DAM|33.41|36.52
SZ|Manzini|SHO|-26.36|31.72
TD|N'Djamena|NDJ|12.13|15.03
TG|Lomé|LFW|6.17|1.25
TH|Bangkok|BKK|13.69|100.75
TJ|Dushanbe|DYU|38.54|68.83
TL|Dili|DIL|-8.55|125.52
TM|Ashgabat|ASB|37.99|58.36
TN|Tunis|TUN|36.85|10.23
TO|Nuku'alofa|TBU|-21.24|-175.15
TR|Istanbul|IST|41.26|28.74
TT|Port of Spain|POS|10.60|-61.34
TV|Funafuti|FUN|-8.53|179.20
TW|Taipei|TPE|25.08|121.23
TZ|Dar es Salaam|DAR|-6.88|39.20
UA|Kyiv|KBP|50.35|30.89
UG|Entebbe|EBB|0.04|32.44
US|New York|JFK|40.64|-73.78
UY|Montevideo|MVD|-34.84|-56.03
UZ|Tashkent|TAS|41.26|69.28
VC|Kingstown|SVD|13.16|-60.98
VE|Caracas|CCS|10.60|-66.99
VN|Ho Chi Minh City|SGN|10.82|106.65
VU|Port Vila|VLI|-17.70|168.32
WS|Apia|APW|-13.83|-172.01
XK|Pristina|PRN|42.57|21.04
YE|Sana'a|SAH|15.48|44.22
ZA|Johannesburg|JNB|-26.13|28.24
ZM|Lusaka|LUN|-15.33|28.45
ZW|Harare|HRE|-17.93|31.09
`;

export type Airport = { country: string; name: string; code: string; lat: number; lng: number };

export const COUNTRY_AIRPORTS: Airport[] = DATA.trim()
  .split('\n')
  .map((line) => {
    const [country, name, code, lat, lng] = line.split('|');
    return { country: country!, name: name!, code: code!, lat: Number(lat), lng: Number(lng) };
  });

const BY_COUNTRY = new Map(COUNTRY_AIRPORTS.map((a) => [a.country, a]));

/** The country's main international airport, if it has one. */
export const hubOf = (iso2: string) => BY_COUNTRY.get(iso2.toUpperCase()) ?? null;
