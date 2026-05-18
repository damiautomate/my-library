// ============================================================
// MY LIBRARY — Classification Taxonomy
// All vocabularies for the multi-dimensional classification.
// Source: spec §9 & Appendix A.
// ============================================================

// ------------------------------------------------------------
// 9.1 Life Domains (26)
// ------------------------------------------------------------
export const LIFE_DOMAINS = {
  mindset_inner_game: "Mindset & Inner Game",
  productivity_time_management: "Productivity & Time Management",
  habits_routines: "Habits & Routines",
  emotional_intelligence: "Emotional Intelligence & Self-Mastery",
  communication_social_skills: "Communication & Social Skills",
  leadership_influence: "Leadership & Influence",
  career_professional: "Career & Professional Development",
  financial_intelligence: "Financial Intelligence",
  health_energy: "Health & Energy",
  learning_intellectual: "Learning & Intellectual Growth",
  relationships_interpersonal: "Relationships & Interpersonal",
  purpose_meaning: "Purpose, Meaning & Motivation",
  focus_attention: "Focus & Attention Management",
  self_organization_systems: "Self-Organization & Systems",
  creativity_innovation: "Creativity & Innovation",
  character_integrity: "Character & Integrity",
  lifestyle_design: "Lifestyle Design",
  spiritual_development: "Spiritual Development",
  parenting_family: "Parenting & Family",
  personal_presentation: "Personal Presentation & Image",
  recreation_play: "Recreation, Play & Adventure",
  service_contribution_legacy: "Service, Contribution & Legacy",
  cultural_identity: "Cultural & Identity Development",
  sexuality_intimacy: "Sexuality & Intimacy",
  digital_life_technology: "Digital Life & Technology Management",
  civic_community_engagement: "Civic & Community Engagement",
} as const;
export type LifeDomain = keyof typeof LIFE_DOMAINS;
export const LIFE_DOMAIN_KEYS = Object.keys(LIFE_DOMAINS) as LifeDomain[];

// ------------------------------------------------------------
// 9.2 Life Stages (7)
// ------------------------------------------------------------
export const LIFE_STAGES = {
  awakening: "Stage 1 — Awakening",
  foundation: "Stage 2 — Foundation",
  skill_building: "Stage 3 — Skill Building",
  establishment: "Stage 4 — Establishment",
  expansion: "Stage 5 — Expansion",
  mastery: "Stage 6 — Mastery",
  legacy_fulfilment: "Stage 7 — Legacy & Fulfilment",
} as const;
export type LifeStage = keyof typeof LIFE_STAGES;
export const LIFE_STAGE_KEYS = Object.keys(LIFE_STAGES) as LifeStage[];

export const LIFE_STAGE_PROFILES: Record<LifeStage, string> = {
  awakening: "Realising the need to take charge; identity and direction forming",
  foundation: "Building basic disciplines: habits, health, finance, faith",
  skill_building: "Becoming marketable; acquiring real skills",
  establishment: "Earning consistently, reputation forming, first leadership",
  expansion: "Scaling impact, income, team, family",
  mastery: "Authority in field, mentoring others, wealth multiplying",
  legacy_fulfilment: "Transmitting wisdom and wealth; finished work",
};

// ------------------------------------------------------------
// 9.3 Rooms (11)
// ------------------------------------------------------------
export const ROOMS = {
  hall_of_awakening: {
    label: "The Hall of Awakening",
    desc: "Purpose, identity, character",
    icon: "Compass",
  },
  foundation_room: {
    label: "The Foundation Room",
    desc: "Habits, discipline, health",
    icon: "Anchor",
  },
  workshop: {
    label: "The Workshop",
    desc: "Skills, craft, career building",
    icon: "Hammer",
  },
  counting_room: {
    label: "The Counting Room",
    desc: "Financial intelligence",
    icon: "Coins",
  },
  chapel: {
    label: "The Chapel",
    desc: "Spiritual development",
    icon: "Cross",
  },
  drawing_room: {
    label: "The Drawing Room",
    desc: "Relationships, family, intimacy",
    icon: "Heart",
  },
  war_room: {
    label: "The War Room",
    desc: "Leadership and hard decisions",
    icon: "Crown",
  },
  observatory: {
    label: "The Observatory",
    desc: "Vision, strategy, big-picture thinking",
    icon: "Telescope",
  },
  garden: {
    label: "The Garden",
    desc: "Recreation, creativity, rest",
    icon: "Trees",
  },
  hall_of_elders: {
    label: "The Hall of Elders",
    desc: "Biographies, memoirs, wisdom",
    icon: "ScrollText",
  },
  childrens_wing: {
    label: "The Children's Wing",
    desc: "Books for young readers",
    icon: "Baby",
  },
} as const;
export type Room = keyof typeof ROOMS;
export const ROOM_KEYS = Object.keys(ROOMS) as Room[];

// ------------------------------------------------------------
// 9.4 Reader Level (3)
// ------------------------------------------------------------
export const READER_LEVELS = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
} as const;
export type ReaderLevel = keyof typeof READER_LEVELS;
export const READER_LEVEL_KEYS = Object.keys(READER_LEVELS) as ReaderLevel[];

// ------------------------------------------------------------
// 9.5 Reading Modes (5)
// ------------------------------------------------------------
export const READING_MODES = {
  quick_read: "Quick Read",
  deep_study: "Deep Study",
  reference: "Reference",
  re_read: "Re-Read",
  apply_as_you_read: "Apply As You Read",
} as const;
export type ReadingMode = keyof typeof READING_MODES;
export const READING_MODE_KEYS = Object.keys(READING_MODES) as ReadingMode[];

// ------------------------------------------------------------
// 9.6 Cultural Contexts (6)
// ------------------------------------------------------------
export const CULTURAL_CONTEXTS = {
  christian: "Christian-grounded",
  secular: "Secular",
  african: "African",
  nigerian: "Nigerian",
  western: "Western",
  classical: "Classical",
} as const;
export type CulturalContext = keyof typeof CULTURAL_CONTEXTS;
export const CULTURAL_CONTEXT_KEYS = Object.keys(CULTURAL_CONTEXTS) as CulturalContext[];

// ------------------------------------------------------------
// 9.7 Outcomes (free-form, suggested vocabulary)
// ------------------------------------------------------------
export const OUTCOME_SUGGESTIONS = [
  "build_habits",
  "behavior_change",
  "start_a_business",
  "grow_a_business",
  "lead_a_team",
  "manage_money",
  "invest",
  "find_purpose",
  "recover_from_grief",
  "improve_marriage",
  "parent_better",
  "improve_focus",
  "read_better",
  "write_better",
  "speak_better",
  "make_decisions",
  "pray_better",
  "study_scripture",
  "find_calling",
  "overcome_fear",
  "build_confidence",
  "manage_stress",
  "lose_weight",
  "get_fit",
  "sleep_better",
  "negotiate_better",
  "network_better",
  "learn_faster",
  "think_clearly",
  "live_simply",
];

// ------------------------------------------------------------
// 9.8 Fields (free-form, career/interest paths)
// ------------------------------------------------------------
export const FIELD_SUGGESTIONS = [
  "general",
  "engineering",
  "software_development",
  "data_science",
  "design",
  "marketing",
  "sales",
  "finance",
  "entrepreneurship",
  "management",
  "theology",
  "philosophy",
  "psychology",
  "medicine",
  "law",
  "education",
  "writing",
  "arts",
  "music",
  "politics",
  "economics",
  "history",
  "science",
];

// ------------------------------------------------------------
// Languages (for the language filter)
// ------------------------------------------------------------
export const LANGUAGES: Record<string, string> = {
  en: "English",
  yo: "Yoruba",
  ig: "Igbo",
  ha: "Hausa",
  fr: "French",
  pcm: "Nigerian Pidgin",
  ar: "Arabic",
  es: "Spanish",
};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
// All take `string` instead of the strict union types because the value
// usually comes from Firestore — old documents may have legacy keys no
// longer in the type union. Falling back to the raw key keeps the UI
// rendering instead of crashing the entire page.

export function domainLabel(key: string): string {
  return LIFE_DOMAINS[key as LifeDomain] ?? key;
}
export function stageLabel(key: string): string {
  return LIFE_STAGES[key as LifeStage] ?? key;
}
export function roomLabel(key: string): string {
  return ROOMS[key as Room]?.label ?? key;
}
export function levelLabel(key: string): string {
  return READER_LEVELS[key as ReaderLevel] ?? key;
}
export function modeLabel(key: string): string {
  return READING_MODES[key as ReadingMode] ?? key;
}
export function contextLabel(key: string): string {
  return CULTURAL_CONTEXTS[key as CulturalContext] ?? key;
}
