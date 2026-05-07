import { useCallback, useEffect, useMemo, useState } from "react";

//Maps
import { DeckGL } from "@deck.gl/react";
import { TileLayer } from "@deck.gl/geo-layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import {
  ArcLayer,
  BitmapLayer,
  ScatterplotLayer,
  GeoJsonLayer,
} from "@deck.gl/layers";
import Map from "react-map-gl/maplibre";
import type { MapViewState } from "@deck.gl/core";
import type { FeatureCollection } from "geojson";

//Charts
import { PieChart, Pie, Cell, Tooltip } from "recharts";

//Geocoding stuffs
import nlp from "compromise";
import cities from "./assets/cities.json";
import countries from "world-countries";
import contextClues from "./assets/contextClues.json";
import countryGeo from "./assets/countryGeo.json";
import rssNews from "./assets/rssNews.json";

import "./App.css";

//Visual stuffs

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 0,
  latitude: 20,
  zoom: 2.5,
  pitch: 0,
  bearing: 0,
};

const CATEGORY_COLORS: Record<string, [number, number, number, number][]> = {
  General: [
    [255, 68, 68, 0],
    [255, 68, 68, 80],
    [255, 100, 50, 160],
    [255, 140, 30, 200],
    [255, 200, 0, 230],
    [255, 255, 255, 255],
  ],
  Politics: [
    [138, 43, 226, 0],
    [138, 43, 226, 80],
    [160, 80, 240, 160],
    [180, 120, 255, 200],
    [210, 180, 255, 230],
    [255, 255, 255, 255],
  ],
  Economics: [
    [0, 200, 100, 0],
    [0, 200, 100, 80],
    [0, 220, 130, 160],
    [50, 240, 160, 200],
    [150, 255, 200, 230],
    [255, 255, 255, 255],
  ],
  Technology: [
    [0, 5, 255, 0],
    [0, 5, 255, 80],
    [30, 60, 255, 160],
    [80, 180, 255, 200],
    [160, 240, 255, 230],
    [255, 255, 255, 255],
  ],
  Science: [
    [255, 165, 0, 0],
    [255, 165, 0, 80],
    [255, 185, 50, 160],
    [255, 205, 100, 200],
    [255, 230, 160, 230],
    [255, 255, 255, 255],
  ],
  Sports: [
    [255, 20, 147, 0],
    [255, 20, 147, 80],
    [255, 60, 170, 160],
    [255, 100, 190, 200],
    [255, 160, 215, 230],
    [255, 255, 255, 255],
  ],
  Climate: [
    [34, 139, 34, 0],
    [34, 139, 34, 80],
    [50, 160, 50, 160],
    [80, 200, 80, 200],
    [150, 255, 150, 230],
    [255, 255, 255, 255],
  ],
};

const DEFAULT_COLORS: [number, number, number, number][] =
  CATEGORY_COLORS["General"];

function formatDate(ts: number): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

//OOP
type GeoArticle = {
  lat: number;
  lng: number;
  city: string;
  category?: string;
  feedProvider: (typeof rssNewsProviders)[0] | undefined;
  providerIcon: string;
  countryFlag?: string;
  article: {
    title: string;
    link: string;
    description: string;
    content: string;
    pubDate: string;
    pubDateTs: number;
  };
};

//Trending topics detection algorithm
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "has",
  "have",
  "had",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "as",
  "up",
  "out",
  "into",
  "about",
  "after",
  "before",
  "over",
  "under",
  "between",
  "through",
  "what",
  "who",
  "how",
  "when",
  "where",
  "why",
  "says",
  "said",
  "new",
  "more",
  "than",
]);

function extractNgrams(title: string, min = 2, max = 5): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  const ngrams: string[] = [];
  for (let n = min; n <= max; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const gram = words.slice(i, i + n).join(" ");
      // skip if any word in the gram is a stop word
      if (words.slice(i, i + n).every((w) => !STOP_WORDS.has(w))) {
        ngrams.push(gram);
      }
    }
  }
  return ngrams;
}

function getTrendingTopics(articles: any[], topN = 5) {
  const phraseToArticles: Record<string, string[]> = {};

  for (const article of articles) {
    const title = article.title ?? "";
    const ngrams = extractNgrams(title);

    for (const gram of ngrams) {
      if (!phraseToArticles[gram]) phraseToArticles[gram] = [];
      if (!phraseToArticles[gram].includes(title)) {
        phraseToArticles[gram].push(title);
      }
    }
  }

  return Object.entries(phraseToArticles)
    .filter(([, titles]) => titles.length > 1)
    .sort((a, b) => {
      const scoreDiff = b[1].length - a[1].length;
      if (scoreDiff !== 0) return scoreDiff;
      return b[0].length - a[0].length;
    })
    .slice(0, topN)
    .map(([phrase, titles]) => ({
      phrase,
      count: titles.length,
    }));
}

//We pull context clues from local json assets/contextClues.json
let contextCluesMap = contextClues;

function weightedLocation(location: string, score: number) {
  return { name: location, score: score };
}

function getLocationFromCity(location: string) {
  return cities
    .filter((city) => city.pop > 100000)
    .sort((a, b) => b.pop - a.pop) //Sort by population to avoid London, Canada shenanigans
    .find(
      (city) => city.name.toLowerCase().trim() == location.toLowerCase().trim(),
    );
}

function getCountryCapitalCoords(countryName: string): [number, number] | null {
  const country = countries.find(
    (c) => c.name.common.toLowerCase() === countryName.toLowerCase(),
  );
  if (!country) return null;
  const capital = getLocationFromCity(country.capital[0]);
  if (!capital) return null;
  return [capital.lat, capital.lon];
}

//RSS Shenanigans

const PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) =>
    `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${url}`,
];

async function fetchWithFallback(url: string): Promise<string> {
  for (const proxy of PROXIES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(proxy(url), { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) continue;
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        if (json.contents) return json.contents;
      } catch {
        // corsproxy returns raw XML
      }
      return text;
    } catch {
      continue;
    }
  }
  throw new Error(`All proxies failed for ${url}`);
}

async function fetchAndParseRSS(
  provider: (typeof rssNewsProviders)[0],
): Promise<GeoArticle[]> {
  const xmlText = await fetchWithFallback(provider.link);

  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "text/xml");
  const items = Array.from(xml.querySelectorAll("item"));
  const providerIcon = xml.querySelector("image url")?.textContent ?? "";
  const articles: GeoArticle[] = [];

  for (const item of items) {
    const title = item.querySelector("title")?.textContent ?? "";
    const link = item.querySelector("link")?.textContent ?? "";
    const description = item.querySelector("description")?.textContent ?? "";
    const content =
      item.querySelector("content\\:encoded, encoded")?.textContent ?? "";
    const pubDate = item.querySelector("pubDate")?.textContent ?? "";
    const pubDateTs = pubDate ? new Date(pubDate).getTime() : 0;

    //Ignore article if its publication date is more than 7 days old
    if (Date.now() - pubDateTs > 7 * 24 * 60 * 60 * 1000) continue;

    let foundLocations: { name: string; score: number }[] = [];

    const titleDoc = nlp(title);
    const descriptionDoc = nlp(description + "; " + content);

    titleDoc
      .places()
      .normalize({ preset: "heavy" })
      .dehyphenate()
      .remove("#Verb")
      .out("array")
      .forEach((place: string) => {
        const n = place
          .toLowerCase()
          .replaceAll("'s", "")
          .replaceAll("'s", "")
          .replaceAll(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
          .trim();
        foundLocations.push(weightedLocation(n, 5));
      });

    descriptionDoc
      .places()
      .normalize({ preset: "heavy" })
      .dehyphenate()
      .remove("#Verb")
      .out("array")
      .forEach((place: string) => {
        const n = place
          .toLowerCase()
          .replaceAll("'s", "")
          .replaceAll("'s", "")
          .replaceAll(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
          .trim();
        foundLocations.push(weightedLocation(n, 1));
      });

    for (const clue of contextCluesMap) {
      if (title.toLowerCase().includes(clue.name.toLowerCase()))
        foundLocations.push(
          weightedLocation(clue.location.toLowerCase(), clue.score * 10),
        );
      if (
        description.toLowerCase().includes(clue.name.toLowerCase()) ||
        content.toLowerCase().includes(clue.name.toLowerCase())
      )
        foundLocations.push(
          weightedLocation(clue.location.toLowerCase(), clue.score),
        );
    }

    const finalScores: { [key: string]: number } = {};
    for (const loc of foundLocations) {
      finalScores[loc.name] = (finalScores[loc.name] ?? 0) + loc.score;
    }

    if (Object.keys(finalScores).length === 0) continue;

    const bestLocation = Object.keys(finalScores).reduce((a, b) =>
      finalScores[a] > finalScores[b] ? a : b,
    );

    let cityData = getLocationFromCity(bestLocation);

    if (!cityData) {
      const countryData = countries.find(
        (c) =>
          c.name.common.toLowerCase().trim() ===
          bestLocation.toLowerCase().trim(),
      );
      if (countryData) cityData = getLocationFromCity(countryData.capital[0]);
    }

    if (!cityData) continue;

    articles.push({
      lat: cityData.lat,
      lng: cityData.lon,
      city: cityData.name,
      category: provider.category,
      countryFlag: (cityData as any).flag,
      feedProvider: provider,
      providerIcon,
      article: { title, link, description, content, pubDate, pubDateTs },
    });
  }

  return articles;
}

const rssNewsProviders = rssNews;

function App() {
  //Fetch a bunch of rss feeds and display them on the map with markers. When you click on a marker, it should show a popup with the title of the news article and a link to the article.

  //First fetch the content of the preconfigured rss providers' urls and convert them to json using rss2json api.
  const [geomarkedArticles, setGeomarkedArticles] = useState<GeoArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAllFeeds() {
      const results = await Promise.allSettled(
        rssNewsProviders.map((provider) => fetchAndParseRSS(provider)),
      );

      const articles: GeoArticle[] = [];

      for (const result of results) {
        if (result.status === "fulfilled") {
          articles.push(...result.value);
        }
      }

      setGeomarkedArticles(articles);
      setLoading(false);
    }

    fetchAllFeeds();
  }, []);

  // console.log(geomarkedArticles);

  // Group geomarked articles by location
  const locationGroups = geomarkedArticles
    .sort((a, b) => b.article.pubDateTs - a.article.pubDateTs)
    .reduce(
      (groups, item) => {
        const key = `${item.lat.toFixed(2)},${item.lng.toFixed(2)}`;
        if (!groups[key]) {
          groups[key] = {
            lat: item.lat,
            lng: item.lng,
            articles: [],
            city: item.city,
            countryFlag: item.countryFlag,
          };
        }
        groups[key].articles.push({
          ...item.article,
          feedProvider: item.feedProvider,
          providerIcon: item.providerIcon,
          category: item.category,
        });
        return groups;
      },
      {} as Record<
        string,
        {
          lat: number;
          lng: number;
          articles: any[];
          city: string;
          countryFlag?: string;
        }
      >,
    );

  //Group articles by country

  //States

  const [selectedGroup, setSelectedGroup] = useState<{
    lat: number;
    lng: number;
    articles: any[];
    city: string;
    countryFlag?: string;
  } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    object: any;
  } | null>(null);
  const [arcData, setArcData] = useState<{
    sourcePosition: [number, number];
    targetPosition: [number, number];
  } | null>(null);
  const [radarPath, setRadarPath] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(INITIAL_VIEW_STATE.zoom);

  const groupedMarkers = Object.values(locationGroups);

  const handleHover = useCallback(({ object, x, y }: any) => {
    setHoverInfo(object ? { x, y, object } : null);
  }, []);

  const handleClick = useCallback(({ object }: any) => {
    if (object) setSelectedGroup(object);
  }, []);

  const allCategories = [...new Set(rssNewsProviders.map((p) => p.category))];
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    new Set(allCategories),
  );

  const trendingTopics = useMemo(() => {
    const allArticles = geomarkedArticles.map((g) => g.article);
    return getTrendingTopics(allArticles, 5);
  }, [geomarkedArticles]);

  const toggleCategory = useCallback((category: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      next.has(category) ? next.delete(category) : next.add(category);
      return next;
    });
  }, []);

  let radarOpacity = Math.max(
    0.0,
    Math.min(0.75, 0.1 + (currentZoom - 1) * 0.08),
  );

  const countryArticleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const article of geomarkedArticles) {
      const countryData = countries.find(
        (c) => c.flag === (article.countryFlag ?? ""),
      );
      // Use the ISO 3166-1 alpha-3 code as the key to match GeoJSON
      if (countryData) {
        const code = countryData.cca3;
        counts[code] = (counts[code] ?? 0) + 1;
      }
    }
    return counts;
  }, [geomarkedArticles]);

  const maxCountryCount = useMemo(
    () => Math.max(1, ...Object.values(countryArticleCounts)),
    [countryArticleCounts],
  );

  const countryLayer = useMemo(() => {
    const active = allCategories.filter((c) => activeCategories.has(c));
    let activeColor = DEFAULT_COLORS;
    if (active.length === 1) {
      activeColor = CATEGORY_COLORS[active[0]] ?? DEFAULT_COLORS;
    }
    return new GeoJsonLayer({
      id: "country-outlines",
      data: countryGeo as unknown as FeatureCollection,
      stroked: true,
      filled: true,
      getLineColor: (f: any) => {
        const code = f.properties.ADM0_A3;
        const count = countryArticleCounts[code] ?? 0;
        if (count === 0) return [255, 255, 255, 0]; // invisible
        const opacity = Math.min(30 + count * 5, 210);
        return [
          activeColor[0][0],
          activeColor[0][1],
          activeColor[0][2],
          opacity,
        ];
      },
      getFillColor: (f: any) => {
        const code = f.properties.ADM0_A3;
        const count = countryArticleCounts[code] ?? 0;
        if (count === 0) return [0, 0, 0, 0]; // fully transparent
        const opacity = Math.min(10 + count * 5, 50);
        return [
          activeColor[0][0],
          activeColor[0][1],
          activeColor[0][2],
          opacity,
        ];
      },
      getLineWidth: (f: any) => {
        const code = f.properties.ADM0_A3;
        const count = countryArticleCounts[code] ?? 0;
        return count > 0 ? 1500 : 0;
      },
      lineWidthUnits: "meters",
      lineWidthMinPixels: 0,
      updateTriggers: {
        getLineColor: [countryArticleCounts],
        getFillColor: [countryArticleCounts],
        getLineWidth: [countryArticleCounts],
      },
    });
  }, [countryArticleCounts, maxCountryCount]);

  //Deck.gl layers

  const filteredGroupedMarkers = useMemo(
    () =>
      groupedMarkers
        .map((group) => ({
          ...group,
          articles: group.articles.filter((a: any) =>
            activeCategories.has(a.category),
          ),
        }))
        .filter((group) => group.articles.length > 0),
    [groupedMarkers, activeCategories],
  );

  const heatmapLayers = useMemo(() => {
    const active = allCategories.filter((c) => activeCategories.has(c));

    // Multiple active: single merged layer, neutral color, fast
    if (active.length > 1) {
      return [
        new HeatmapLayer({
          id: "news-heat-merged",
          data: groupedMarkers.filter((m) =>
            m.articles.some((a: any) => activeCategories.has(a.category)),
          ),
          getPosition: (d) => [d.lat, d.lng],
          getWeight: (d) => {
            const count = d.articles.filter((a: any) =>
              activeCategories.has(a.category),
            ).length;
            return Math.log1p(count) + 1;
          },
          radiusPixels: 90,
          intensity: 1.5,
          threshold: 0.000001,
          aggregation: "SUM",
          colorRange: DEFAULT_COLORS,
        }),
      ];
    }

    // Single active: colored layer for that category
    if (active.length === 1) {
      const category = active[0];
      return [
        new HeatmapLayer({
          id: `news-heat-${category}`,
          data: groupedMarkers.filter((m) =>
            m.articles.some((a: any) => a.category === category),
          ),
          getPosition: (d) => [d.lat, d.lng],
          getWeight: (d: any) => {
            const count = d.articles.filter(
              (a: any) => a.category === category,
            ).length;
            return Math.log1p(count);
          },
          radiusPixels: 90,
          intensity: 1.5,
          threshold: 0.000001,
          aggregation: "SUM",
          colorRange: CATEGORY_COLORS[category] ?? DEFAULT_COLORS,
        }),
      ];
    }

    return [];
  }, [groupedMarkers, activeCategories]);

  const scatterLayer = useMemo(
    () =>
      new ScatterplotLayer({
        id: "news-scatter",
        data: filteredGroupedMarkers,
        getPosition: (d: any) => [d.lat, d.lng],
        getRadius: (d) => Math.min(50000 + d.articles.length * 20000, 300000),
        getFillColor: (d) =>
          d === selectedGroup ? [255, 200, 0, 60] : [255, 68, 68, 20],
        getLineColor: [255, 68, 68, 155],
        stroked: true,
        getLineWidth: 2000,
        lineWidthUnits: "meters",
        pickable: true,
        radiusUnits: "meters",
        onClick: handleClick,
        onHover: handleHover,
        updateTriggers: { getFillColor: [selectedGroup] },
      }),
    [filteredGroupedMarkers, selectedGroup, handleClick, handleHover],
  );

  const arcLayer = useMemo(
    () =>
      new ArcLayer({
        id: "news-arc",
        data: arcData ? [arcData] : [],
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => d.targetPosition,
        getSourceColor: [0, 216, 116, 255],
        getTargetColor: [0, 68, 68, 255],
        getWidth: 6,
        greatCircle: true,
      }),
    [arcData],
  );

  useEffect(() => {
    fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then((r) => r.json())
      .then((data) => {
        const latest = data.radar.past[data.radar.past.length - 1];
        setRadarPath(latest.path); // store path in state
      });
  }, []);

  const radarLayer = useMemo(
    () =>
      radarPath
        ? new TileLayer({
            id: "radar",
            data: `https://tilecache.rainviewer.com${radarPath}/256/{z}/{x}/{y}/50/1_1.png`,
            renderSubLayers: (props) =>
              new BitmapLayer(props, {
                data: undefined,
                image: props.data,
                bounds: props.tile.boundingBox.flat() as [
                  number,
                  number,
                  number,
                  number,
                ],
                opacity: radarOpacity,
              }),
          })
        : null,
    [radarPath, radarOpacity],
  );

  return (
    <div
      className="bg-[#0d0d0d] overflow-hidden"
      style={{ fontFamily: "Montagu Slab, sans-serif" }}
    >
      {/* Header - fixed, floats above canvas */}
      <div className="fixed top-[2vh] left-[2vw] w-[96vw] h-[5vh] bg-[#1a1a1a] rounded-lg flex items-center px-6 z-[999] border border-[#F4D874] shadow-lg">
        <span className="text-white lg:text-3xl text-lg tracking-tight width-[50%] lg:width-auto">
          What's going on?
        </span>

        <div className="flex lg:relative absolute lg:opacity-100 opacity-0 gap-2 ml-auto lg:width-auto lg:overflow-x-visible width-[10%] overflow-x-auto py-1">
          {allCategories.map((category) => {
            const active = activeCategories.has(category);
            // grab first color of the range as the accent
            const [r, g, b] = CATEGORY_COLORS[category]?.[2] ?? [255, 68, 68];
            return (
              <button
                key={category}
                onClick={() => toggleCategory(category)}
                className={`px-3 py-1 rounded-full text-xs font-semibold tracking-wide border transition-all duration-200 ${
                  active ? "opacity-100" : "opacity-30"
                }`}
                style={{
                  borderColor: `rgb(${r},${g},${b})`,
                  color: active ? `rgb(${r},${g},${b})` : "#666",
                  background: active
                    ? `rgba(${r},${g},${b},0.12)`
                    : "transparent",
                }}
              >
                {category}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile categories switcher */}
      <div className="fixed top-[8vh] left-[2vw] w-[96vw] h-[5vh] bg-[#1a1a1a] rounded-lg flex items-center px-2 z-[999] border border-[#F4D874] lg:hidden shadow-lg">
        <div className="flex gap-2 lg:width-auto lg:overflow-x-visible mx-0 overflow-x-auto py-1">
          {allCategories.map((category) => {
            const active = activeCategories.has(category);
            // grab first color of the range as the accent
            const [r, g, b] = CATEGORY_COLORS[category]?.[2] ?? [255, 68, 68];
            return (
              <button
                key={category}
                onClick={() => toggleCategory(category)}
                className={`px-3 py-1 rounded-full lg:text-xs text-[10px] font-semibold tracking-wide border transition-all duration-200 ${
                  active ? "opacity-100" : "opacity-30"
                }`}
                style={{
                  borderColor: `rgb(${r},${g},${b})`,
                  color: active ? `rgb(${r},${g},${b})` : "#666",
                  background: active
                    ? `rgba(${r},${g},${b},0.12)`
                    : "transparent",
                }}
              >
                {category}
              </button>
            );
          })}
        </div>
      </div>

      {/* Map fills entire screen */}
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={[
          countryLayer,
          ...heatmapLayers,
          radarLayer,
          scatterLayer,
          arcLayer,
        ]}
        style={{ width: "100vw", height: "100vh" }}
        onClick={({ object }) => {
          if (!object) setSelectedGroup(null);
        }}
        onViewStateChange={({ viewState }: any) =>
          setCurrentZoom(viewState.zoom)
        }
      >
        <Map mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" />
      </DeckGL>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-[2000] bg-[#0d0d0d] flex flex-col items-center justify-center gap-6">
          {/* Animated pulse rings */}
          <div className="relative flex items-center justify-center">
            <div className="absolute w-24 h-24 rounded-full border border-[#F4D874] opacity-20 animate-ping" />
            <div className="absolute w-16 h-16 rounded-full border border-[#F4D874] opacity-40 animate-ping [animation-delay:0.3s]" />
            <div className="w-8 h-8 rounded-full bg-[#F4D874] opacity-80 animate-pulse" />
          </div>

          <div className="flex flex-col items-center gap-2">
            <span
              className="text-white text-2xl tracking-tight"
              style={{ fontFamily: "Montagu Slab, sans-serif" }}
            >
              What's going on?
            </span>
            <span className="text-[#666] text-xs tracking-widest uppercase">
              Fetching {rssNewsProviders.length} feeds...
            </span>
          </div>

          {/* Progress indicator — shows feeds loading in real time */}
          <div className="flex gap-1.5">
            {rssNewsProviders.map((_, i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-[#F4D874]"
                style={{
                  opacity: 0.2,
                  animation: `pulse 1.5s ease-in-out ${i * 0.12}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tooltip - fixed to cursor */}
      {hoverInfo && (
        <div
          className="fixed pointer-events-none z-[1000] bg-[#111] border border-[#2a2a2a] rounded-lg p-3 max-w-[220px] lg:opacity-100 opacity-0 shadow-md"
          style={{ 
            left: hoverInfo.x + 14, 
            top: hoverInfo.y + 14,
          }}
        >
          <div className="text-[#F4D874] text-[14px] tracking-widest uppercase mb-1 font-bold">
            {hoverInfo.object.countryFlag} {hoverInfo.object.city}
          </div>
          <div className="text-[#ff4444] text-[10px] tracking-widest uppercase mb-2">
            {hoverInfo.object.articles.length} article
            {hoverInfo.object.articles.length > 1 ? "s" : ""}
          </div>
          <div className="text-[#ccc] text-xs leading-relaxed">
            {hoverInfo.object.articles[0]?.title?.slice(0, 60)}...
          </div>
        </div>
      )}

      {/* Sidebar */}
      {selectedGroup && (
        <div
          className="fixed right-[2vw] lg:top-[8vh] bottom-[2vh] lg:h-[86vh] h-[60vh] lg:w-[40vw] w-[96vw] rounded-lg bg-[#111] border border-[#F4D874] p-4 z-[999] text-white shadow-lg"
        >
          <div className="flex flex-row justify-between">
            <h2 className="text-[#F4D874] text-2xl tracking-widest uppercase mb-1 font-bold">
              {selectedGroup.countryFlag} {selectedGroup.city}
            </h2>
            <button
              className="text-[#F4D874] p-1 m-1 rounded-full mono"
              onClick={() => {
                setSelectedGroup(null);
              }}
            >
              X
            </button>
          </div>
          <div className="overflow-y-auto lg:h-[70%] h-[50%] py-2 border-t border-[#2a2a2a]">
            {selectedGroup.articles
              .sort((a, b) => b.pubDateTs - a.pubDateTs)
              .map((article, index) => (
                <div
                  key={index}
                  className="mb-2 p-2 rounded-lg border border-[#2a2a2a] border-l-5 hover:border-[#F4D874] transition-colors"
                  onMouseEnter={() => {
                    const providerCoords = getCountryCapitalCoords(
                      article.feedProvider?.originCountry ?? "",
                    );
                    if (providerCoords && selectedGroup) {
                      setArcData({
                        sourcePosition: providerCoords,
                        targetPosition: [selectedGroup.lat, selectedGroup.lng],
                      });
                    }
                  }}
                  onMouseLeave={() => setArcData(null)}
                >
                  <div className="flex flex-row items-start gap-2">
                    {article.providerIcon && (
                      <img
                        src={article.providerIcon}
                        alt="Provider Icon"
                        className="w-5 h-5 mt-1 rounded-sm flex-shrink-0"
                      />
                    )}
                    <div className="flex flex-col gap-1">
                      <div className="text-[11px] text-[#666] flex flex-row items-center gap-1">
                        {article.feedProvider?.name ?? "Unknown"},{" "}
                        {article.feedProvider?.originCountry ?? ""}
                        {(() => {
                          const [r, g, b] = (CATEGORY_COLORS[
                            article.category
                          ]?.[2] ?? [255, 68, 68]) as [
                            number,
                            number,
                            number,
                            number?,
                          ];
                          return (
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                              style={{
                                borderColor: `rgb(${r},${g},${b})`,
                                color: `rgb(${r},${g},${b})`,
                                background: `rgba(${r},${g},${b},0.12)`,
                              }}
                            >
                              {article.category}
                            </span>
                          );
                        })()}
                      </div>
                      <a
                        href={article.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-[#eee] leading-snug hover:text-[#F4D874] transition-colors"
                      >
                        {article.title}
                      </a>
                      <p className="text-[10px] text-[#444]">
                        {formatDate(article.pubDateTs)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
          </div>

          {/* Pie chart section */}
          <div className="border-t border-[#2a2a2a] mt-4 pt-4">
            <div className="text-[#F4D874] text-lg font-bold tracking-widest uppercase mb-2">
              Coverage:
            </div>
            {(() => {
              const providerCounts: Record<string, number> = {};
              for (const art of selectedGroup.articles) {
                const providerName = art.feedProvider?.name || "Unknown";
                providerCounts[providerName] =
                  (providerCounts[providerName] || 0) + 1;
              }
              const sorted = Object.entries(providerCounts).sort(
                (a, b) => b[1] - a[1],
              );
              const top5 = sorted.slice(0, 5);
              const othersCount = sorted
                .slice(5)
                .reduce((sum, [, c]) => sum + c, 0);
              const chartData = top5.map(([name, count]) => ({
                name,
                value: count,
              }));
              if (othersCount > 0)
                chartData.push({ name: "...", value: othersCount });

              return (
                <>
                  <div className="flex flex-row w-[100%] items-center justify-around">
                    <div className="flex justify-center">
                      <PieChart width={200} height={160}>
                        <Pie
                          data={chartData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          fill="#F4D874"
                          stroke="#2a2a2a"
                          labelLine={false}
                        >
                          {chartData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={
                                [
                                  "#F4D874",
                                  "#ff8c42",
                                  "#ff3b3b",
                                  "#4c9aff",
                                  "#6b4cff",
                                  "#888",
                                ][index % 6]
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value) =>
                            `${value} article${value !== 1 ? "s" : ""}`
                          }
                        />
                      </PieChart>
                    </div>
                    <div className="flex flex-col w-full gap-2 justify-center lg:text-[12px] text-[9px] mt-2">
                      {top5.map(([name, count]) => (
                        <span
                          key={name}
                          className="bg-[#1a1a1a] px-2 py-0.5 rounded-full"
                        >
                          {name} ({count})
                        </span>
                      ))}
                      {othersCount > 0 && (
                        <span className="bg-[#1a1a1a] px-2 py-0.5 rounded-full">
                          others ({othersCount})
                        </span>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Trending topics section */}
      <div className="fixed left-[2vw] lg:top-[8vh] top-[14vh] lg:w-[18vw] w-[96vw] rounded-lg bg-[#111] border border-[#2a2a2a] p-4 z-[999] shadow-lg">
        <div className="text-[#F4D874] text-[14px] tracking-widest uppercase mb-3 font-bold">
          Trending
        </div>

        {loading ? (
          <div className="text-[#444] text-xs">Loading...</div>
        ) : (
          <div className="flex lg:flex-col flex-row lg:width-auto overflow-x-auto py-1 gap-2">
            {trendingTopics.map((topic, i) => (
              <div
                key={i}
                className="flex lg:items-start gap-2 group lg:w-auto w-[200%]"
              >
                <span className="text-[#333] text-[10px] font-mono mt-0.5 w-4 flex-shrink-0">
                  {i + 1}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[#eee] lg:text-sm text-xs leading-snug capitalize">
                    {topic.phrase}
                  </span>
                  <span className="text-[#444] text-[10px]">
                    {topic.count} article{topic.count > 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer information */}
      <div className="fixed bottom-2 right-2 w-[20vw] h-[5vh] flex items-center justify-center px-6 z-[999] text-right">
        <span className="text-[#aaa] text-[8px] tracking-wide">
          Deck.gl, React, Compromise NLP, MapLibre, OpenStreetMaps, RainViewer, Recharted, Tailwind CSS
          <br />
          <br />
          Made by MateussDev - 2026
        </span>
      </div>
    </div>
  );
}

export default App;
