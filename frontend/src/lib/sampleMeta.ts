import meta from "../../public/sample/sample_meta.json";

export interface FeaturedCase {
  key: string;
  title: string;
  blurb: string;
  left: string;
  right: string;
  decision_id: string;
}

export const SAMPLE_META = meta as { title: string; note: string; cpses: Array<{ id: string; label: string }>; showcase_records: string[]; featured: FeaturedCase[] };
