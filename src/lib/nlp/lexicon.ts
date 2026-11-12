/**
 * Word lists shared by the text-intelligence modules (entity extraction, chunking, query parsing).
 * Everything here is plain data — no logic, no DOM — so it is cheap to import anywhere.
 */

const words = (s: string): string[] => s.trim().split(/\s+/);

/**
 * General English stopwords: function words, pronouns, auxiliaries and contractions written without the
 * apostrophe (tokenizers strip apostrophes, so "don't" becomes "dont").
 */
export const STOPWORDS: ReadonlySet<string> = new Set(
  words(`
  a about above across after afterwards again against ago all almost alone along already also although always am
  among amongst an and another any anybody anyhow anyone anything anyway anyways anywhere are aren arent around as
  at away be became because become becomes becoming been before beforehand behind being below beside besides
  between beyond both but by can cannot cant could couldnt couldve did didnt do does doesnt doing done dont down
  during each eg either else elsewhere enough etc even ever every everybody everyone everything everywhere except
  few for former formerly from further furthermore had hadnt has hasnt have havent having he hed hell hence her
  here hereafter hereby herein heres hers herself hes him himself his how however hows i ie if im in indeed
  instead into is isnt it itd itll its itself ive just least less let lets may maybe me meanwhile might mightnt
  mine more moreover most mostly much must mustnt my myself namely neither never nevertheless next no nobody none
  noone nor not nothing now nowhere of off often oh ok okay on once one ones only onto or other others otherwise
  ought our ours ourselves out over own per perhaps please quite rather really same several shall shant she shed
  shell shes should shouldnt shouldve since so some somebody somehow someone something sometime sometimes
  somewhat somewhere still such than that thatd thatll thats the their theirs them themselves then thence there
  thereafter thereby therefore therein theres thereupon these they theyd theyll theyre theyve this those though
  through throughout thru thus to together too toward towards under unless until unto up upon us very via vs was
  wasnt we wed well were werent weve what whatever whats when whence whenever where whereafter whereas whereby
  wherein wheres whereupon wherever whether which while whither who whod whoever whole wholl whom whos whose why
  will with within without wont would wouldnt wouldve yeah yes yet you youd youll your youre yours yourself
  yourselves youve
  `),
);

/** Low-information words that are never good topics (generic verbs, time words, receipt boilerplate…). */
export const GENERIC_WORDS: ReadonlySet<string> = new Set(
  words(`
  able actually add added agreed also amount around awesome back bad best better big came come comes coming cool
  could day days did guess hope noted perfect sounds totally
  does done else even every first follow following four from gave give given gives going gone good got great have
  hello here http https item items keep kept know knew last later left less like little long look looked looking
  number numbers
  looks lot lots made make makes making many might more most much must need needed needs never next nice note
  notes okay page pages part people place please point pretty put really regards right said same says second see
  seen sent should show shown since some sorry soon still subject subtotal sure take taken takes thank thanks thing
  things think third though thought three time times today told tomorrow took total true two used uses using want
  wanted wants
  week weeks well went whole will work would year years yesterday your
  `),
);

/** Greetings, sign-offs and sentence openers that are capitalised but are never part of a name. */
export const NAME_NOISE: ReadonlySet<string> = new Set(
  words(`
  hi hello hey dear thanks thank regards best cheers sincerely yours ok okay yes no please congrats congratulations
  welcome greetings attn attention re fwd fw cc bcc subject from to sent date time note notes total subtotal page
  invoice receipt amount balance due tax qty quantity price item items description details summary agenda minutes
  meeting action report status update updates draft final review overview introduction conclusion appendix table
  contents chapter section figure step steps todo idea ideas question questions answer answers important reminder
  reminders call email phone mobile address website name number account order payment paid customer client
  important urgent new today tomorrow yesterday morning afternoon evening night week month year
  head director manager chief officer president vice engineer lead senior junior associate assistant intern founder
  cofounder co-founder partnerships sales marketing finance legal operations department dept team executive analyst
  consultant designer developer coordinator specialist administrator representative supervisor principal staff
  `),
);

/**
 * Imperative verbs that often start a sentence with a capital letter ("Call Sarah tomorrow") and must not be
 * mistaken for the first word of a name.
 */
export const SENTENCE_VERBS: ReadonlySet<string> = new Set(
  words(`
  ask book bought bring brought buy call cancel check confirm contact discuss email find fix follow found gave get
  give go got had heard invite kept knew left let made meet message met move order paid pay pick ping plan read
  remember remind reply review said saw schedule send sent share sign spoke submit take talk tell text thank told
  took try update visit wait watch went write wrote
  `),
);

/** Honorifics dropped from the start of a name ("Dr. Sarah Chen" → "Sarah Chen"). */
export const HONORIFICS: ReadonlySet<string> = new Set(
  words("mr mrs ms miss mx dr prof sir madam madame mme mlle herr frau sr sra shri smt sri capt col gen lt sgt rev fr"),
);

/** Lowercase particles allowed inside a multi-word name ("Bank of America", "Ludwig van Beethoven"). */
export const NAME_CONNECTORS: ReadonlySet<string> = new Set(
  words("of the de van von der den da di du del della des dos das la le bin ibn al el y ter ten zu"),
);

/** Company suffixes that stay attached to a name ("Acme Inc", "Globex GmbH", "Initech Pvt. Ltd."). */
export const COMPANY_SUFFIXES: ReadonlySet<string> = new Set(
  words("inc llc ltd gmbh corp co plc llp ag sa pvt limited corporation company bv nv oy ab srl spa kk pty"),
);

/** Upper-case tokens that look like acronyms but carry no identity (formats, units, receipt words…). */
export const ACRONYM_NOISE: ReadonlySet<string> = new Set(
  words(`
  am pm ok id tv pc pdf png jpg jpeg gif csv txt doc docx xls xlsx ppt html css js url uri http https www ftp api
  ui ux faq asap fyi eta tbd tba rsvp ps nb qty gst vat tax due net total mrp emi otp pin atm upi sms mms no yes
  and the for not but all are was has had new usd eur gbp inr jpy aud cad chf cny hkd sgd aed rs mr mrs ms dr st
  rd nd th ft kg km cm mm ml lb oz hr hrs min mins sec am pm est pst gmt utc ist cet bst edt pdt cst mst eod eow
  cob tldr imo imho btw lol omg diy kpi roi ceo cto cfo coo vp svp evp hr pr qa it is in on of to at by be or as
  an if so do we he me my up us ad ae fw fwd re cc bcc
  `),
);

/** Month names and abbreviations → 0-based month index. */
export const MONTHS: Readonly<Record<string, number>> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

/** Regex source matching any month name/abbreviation (use with the `i` flag). */
export const MONTH_PATTERN =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** Weekday names and abbreviations → JS day index (0 = Sunday). */
export const WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** Calendar words that never form (part of) a name. "Jan" is left out on purpose — it is also a first name. */
export const CALENDAR_WORDS: ReadonlySet<string> = new Set(
  words(`
  january february march april may june july august september october november december feb mar apr jun jul aug
  sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri
  sat sun today tomorrow yesterday tonight
  `),
);

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Small number words used in natural time phrases ("two weeks ago", "a couple of days"). */
export const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, couple: 2, few: 3, several: 4,
};
