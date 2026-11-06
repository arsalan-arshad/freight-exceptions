// Readable word lists and patterns used by validateDraft. One place to review and extend.
// Everything here is a DENY list for text a person did not write. It is a deterministic net, not a guarantee:
// see the "NOT guaranteed" notes in validate.ts.

export type Labeled = Array<[RegExp, string]>;

// ---- placeholder / template junk --------------------------------------------------------------------------------
export const PLACEHOLDER_PATTERNS: Labeled = [
  [/[[\]]/, 'square brackets (placeholder or link markup)'],
  [/[{}]/, 'curly braces (template placeholder)'],
  [/<[^<>\n]{1,40}>/, 'angle-bracket placeholder or tag'],
  [/\bundefined\b/i, "the word 'undefined'"],
  [/\bnull\b/i, "the word 'null'"],
  [/\bnan\b/i, "the word 'NaN'"],
  [/\b(?:todo|tbd|lorem ipsum)\b/i, 'placeholder text'],
  [/_{3,}/, 'blank placeholder'],
];

// ---- prompt-injection / assistant-meta echoes ---------------------------------------------------------------------
export const INJECTION_PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\b/i,
  /\bsystem prompt\b/i,
  /\b(?:as|i am|i'm)\s+an?\s+(?:ai|language model|assistant)\b/i,
  /\b(?:jailbreak|developer mode)\b/i,
];

// ---- promises, commitments, threats, blame ------------------------------------------------------------------------
export const PROMISE_PATTERNS: Labeled = [
  // legal
  [/\b(?:legal action|legal proceedings|lawsuit|sue|sued|suing|attorneys?|lawyers?|litigation|small claims|collections? agency|court|legal team|legal department)\b/i, 'legal threat'],
  [/\breserves?\s+(?:all|any|our|the)\s+(?:\w+\s+)?rights?\b|\bwithout prejudice\b|\bpursue\s+(?:all\s+)?(?:our\s+)?(?:remed\w+|claims?|damages)\b|\bremed(?:y|ies)\b|\bdamages\b/i, 'legal reservation of rights'],
  [/\breport(?:ing|ed)?\s+(?:you|this|the carrier|your\s+\w+)\s+to\b|\b(?:fmcsa|better business bureau|bbb|authorities|police)\b/i, 'threat to report'],
  // penalties
  [/\bpenalt(?:y|ies)\b|\bfines\b|\bfined\b|\ba fine\b|\bfine of\b|\bchargebacks?\b|\bback-?charges?\b|\bliquidated damages\b|\bsanctions?\b/i, 'penalty'],
  // guarantees and promises
  [/\bguarant(?:ee|eed|ees|eeing)\b|\bpromis(?:e|es|ed|ing)\b|\bassure[sd]?\b|\bcommit(?:s|ted)? to\b/i, 'guarantee or promise'],
  [/\bmake sure (?:you|they|the carrier|everyone)\b|\bmake (?:it|this|things) right\b|\bmake good\b|\bmake up for\b/i, 'promise'],
  // payment and cost commitments
  [/\b(?:will|shall|would|won't|'ll|going to|agree(?:s|d)? to|promise(?:s|d)? to|commit(?:s|ted)? to|be)\s+(?:\w+\s+){0,2}(?:pay|paid|reimburse|reimbursed|refund|refunded|compensate|compensated|settle|settled)\b/i, 'payment commitment'],
  [/\b(?:pay|paying)\s+(?:you|them|the carrier|in full|immediately|promptly|right away|today|on time)\b/i, 'payment commitment'],
  [/\b(?:get|gets|getting|got)\s+paid\b/i, 'payment commitment'],
  [/\bpayment\s+(?:will|shall|is guaranteed|is approved|has been (?:approved|released))\b|\bwe(?:'ll| will)\s+(?:release|issue|send)\s+(?:the\s+)?(?:payment|funds|check|wire)\b/i, 'payment commitment'],
  [/\b(?:cover|absorb|bear|eat|take care of)\s+(?:the\s+|all\s+|any\s+|your\s+|those\s+|these\s+)?(?:\w+\s+)?(?:costs?|expenses?|fees?|charges?|losses|loss)\b/i, 'cost commitment'],
  [/\b(?:refund|reimburse|reimbursement|compensation|compensate|indemnif\w+|liable|liability)\b/i, 'liability or payment language'],
  [/\b(?:will|shall|going to|'ll)\s+(?:also\s+|then\s+)?(?:charge|bill|invoice|deduct|fine|back-?charge)\b|\bcharge\s+(?:you|them|the carrier)\b/i, 'charge commitment'],
  // blame and responsibility
  [/\bhold(?:ing)?\s+(?:you|them|the carrier|your\s+\w+)\s+(?:responsible|accountable|liable)\b|\byou(?:'re| are)\s+(?:responsible|accountable|at fault|to blame)\b|\bat fault\b|\bblame\b/i, 'blame or responsibility claim'],
  // ending the relationship
  [/\bcancel(?:l?ing|l?ed)?\s+(?:your|the|our|this|that)\s+(?:contract|agreement|account|business|load|booking|rate|relationship)\b|\b(?:not|never)\s+(?:use|book|hire|trust|work with)\s+(?:you|them|your company)\b|\bno longer\s+(?:use|work with|book)\b/i, 'threat to end the relationship'],
  [/\b(?:withhold|withholding|deduct(?:ion|ed)?|short-?pay|terminate|termination|blacklist\w*|cease working|stop (?:using|working with)|take our business|never (?:use|work with|book))\b/i, 'threat'],
  // commitments made on the sender's behalf
  [/\b(?:waive|waiver|we accept|we agree|we approve|we authori[sz]e|we honou?r|approved the (?:charge|detention))\b/i, 'commitment on behalf of the sender'],
  [/\bor else\b|\bfinal (?:notice|warning)\b|\blast chance\b|\bunacceptable\b/i, 'threat or ultimatum'],
];

// ---- insults and profanity -----------------------------------------------------------------------------------------
export const INSULT_PATTERNS: Labeled = [
  [/\bf+[u*#@]+[c*k#@]+|\bsh[i*#@]+[t*#@]+/i, 'profanity (masked)'],
  [/\b(?:thie(?:f|ves)|steal(?:ing)?|stole|scam(?:mer|ming)?|fraud(?:ulent|ster)?|crooks?|crooked|liars?|lying|lied|cheat(?:s|ing|ed|er)?|negligen(?:t|ce)|dishonest)\b/i, 'accusation'],
  [/\b(?:incompeten(?:t|ce)|useless|worthless|idiots?|idiotic|stupid|morons?|moronic|clowns?|pathetic|lazy|unprofessional|disgrace\w*|garbage|trash|ridiculous|amateurs?)\b/i, 'insult'],
  [/\b(?:f+u+c+k\w*|sh[i1]+t\w*|damn\w*|bastards?|b[i1]tch\w*|assholes?|dumbass\w*|crap\w*|piss\w*|bullshit|hell|wtf|stfu|screw you)\b/i, 'profanity'],
];

// ---- wrong-party / false-status claims we can recognise (NOT exhaustive) --------------------------------------------
export const CLAIM_PATTERNS: Labeled = [
  [/\b(?:arrest(?:ed)?|accidents?|crash(?:ed)?|stolen|theft|hijack\w*|injur\w+|impound\w*|seiz(?:ed|ure)|abandon\w*|broke\s+down|breakdown|rollover|rolled over|in jail|towed)\b/i, 'unverified incident or status claim'],
  [/\bwe (?:can |do |hereby )?confirm\b|\b(?:has|have) been confirmed\b|\bis confirmed\b|\bwas confirmed\b/i, 'sender-side confirmation not made by a person'],
];
/** Words that address someone other than the carrier. Banned in carrier-facing drafts unless they are in the facts. */
export const WRONG_PARTY_RE = /\b(?:customers?|shippers?|consignees?|receivers?)\b/i;
export const GREETING_RE = /\b(?:hi|hello|hey|dear)\b/gi;

// ---- vague / relative quantities and timing (no digits needed) ------------------------------------------------------
export const VAGUE_PATTERNS: Labeled = [
  [/\ba dozen\b|\bdozens?\b|\bscores of\b|\bcouple of\b|\ba couple\b|\bhundreds of\b|\bthousands of\b/i, 'vague quantity'],
  [/\b(?:a few|several|a number of|many|multiple|some)\s+(?:more\s+)?(?:\w+\s+)?(?:hours?|minutes?|mins?|days?|weeks?|months?|dollars?|bucks?|usd|euros?|pallets?|miles?)\b/i, 'vague quantity of time or money'],
  [/\bhalf\s+(?:an?|the)\s+(?:hour|day|week)\b|\bhalf-(?:hour|day)\b|\b(?:a |one )?quarter (?:of )?an? hour\b|\b(?:an?|one) (?:hour|day|week) and a half\b/i, 'fractional time'],
  [/\bnext[\s-](?:week|month|year|day|business day|working day|morning|monday|tuesday|wednesday|thursday|friday|saturday|sunday|few)\b/i, 'relative timing ("next ...")'],
  [/\blater (?:today|tonight|this \w+)\b|\bthis (?:week|weekend|month)\b|\bsame[\s-]day\b|\bovernight\b/i, 'relative timing'],
  [/\b(?:by|before|until|till|at)\s+(?:the\s+)?(?:end|close) of (?:the\s+)?(?:day|week|month|shift|business(?: day)?)\b/i, 'deadline wording ("end of day")'],
  [/\bwithin\s+(?:the\s+)?(?:hour|day|week|month|next)\b|\bin the next\b/i, 'relative timing ("within ...")'],
  [/\b(?:eod|cob|close of business|end of business)\b/i, 'deadline wording'],
  [/\b(?:in|during) the (?:morning|afternoon|evening)\b|\bshortly\b|\basap\b|\bas soon as possible\b|\bright away\b|\bimmediately\b|\bsoonest\b/i, 'vague timing'],
];

/** Time-of-day / deadline words. Allowed only if the same word is in a (rule-computed) fact value. */
export const TIMEISH_RE =
  /\b(noon|midnight|tomorrow|yesterday|tonight|this (?:morning|afternoon|evening)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

// ---- payment instructions (used to vet free-text facts such as a carrier name) --------------------------------------
export const PAYMENT_INSTRUCTION_RE =
  /\b(?:wire|wired|wiring|iban|swift|bic|routing|aba|account\s*(?:number|no|#)|acct|bitcoin|btc|crypto\w*|ethereum|usdt|paypal|zelle|venmo|cash\s?app|western union|moneygram|gift\s?cards?|bank|pay|payment|payments|invoice|remit\w*|transfer)\b/i;

// ---- English number words -----------------------------------------------------------------------------------------
export const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
export const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
export const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export const BIG: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };
export const ORDINAL_RE = /\b(?:fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|(?:thir|four|fif|six|seven|eigh|nine)teenth|(?:twen|thir|for|fif|six|seven|eigh|nine)tieth|hundredth|thousandth)\b/i;

export const UNITS = new Set([
  'hour', 'hours', 'hr', 'hrs', 'minute', 'minutes', 'min', 'mins', 'day', 'days', 'week', 'weeks', 'month', 'months',
  'dollar', 'dollars', 'buck', 'bucks', 'usd', 'eur', 'cad', 'euro', 'euros', 'cent', 'cents', 'percent', 'pallet', 'pallets',
  'piece', 'pieces', 'mile', 'miles', 'pound', 'pounds', 'lb', 'lbs', 'am', 'pm', "o'clock", 'load', 'loads',
]);
export const SINGULAR_UNITS = new Set(['hour', 'minute', 'day', 'week', 'month', 'dollar', 'buck', 'cent']);

// ---- foreign-language number words (Latin script; accents and sharp s are folded before matching) -----------------------
// Deliberately excludes words that are also common English: once, un, um, due, sept, cent, elf, six, ten, no.
export const FOREIGN_NUMBER_WORDS = new Set([
  // Spanish
  'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'doce', 'trece', 'catorce', 'quince',
  'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'ciento', 'mil', 'docena',
  // French
  'deux', 'trois', 'quatre', 'cinq', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze',
  'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'mille', 'douzaine',
  // German
  'eins', 'zwei', 'drei', 'vier', 'funf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'zwolf', 'dreizehn', 'vierzehn',
  'funfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn', 'zwanzig', 'dreissig', 'vierzig', 'funfzig', 'sechzig',
  'siebzig', 'achtzig', 'neunzig', 'hundert', 'tausend',
  // Portuguese
  'dois', 'duas', 'quatro', 'sete', 'oito', 'dez', 'treze', 'catorze', 'quinze', 'vinte', 'trinta', 'quarenta',
  'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa', 'cem', 'cento',
  // Italian
  'tre', 'quattro', 'cinque', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'venti', 'trenta', 'quaranta', 'cinquanta',
  'sessanta', 'settanta', 'ottanta', 'novanta', 'cento', 'mille',
]);
/** Compound forms: veinticuatro, vierundzwanzig, ... */
export const FOREIGN_COMPOUND_RE = /^(?:veinti[a-z]+|(?:ein|zwei|drei|vier|funf|sechs|sieben|acht|neun)und(?:zwanzig|dreissig|vierzig|funfzig|sechzig|siebzig|achtzig|neunzig))$/;
