import { useCallback, useEffect, useMemo, useState } from "react";

//Maps
import { DeckGL } from "@deck.gl/react";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers";
import Map from "react-map-gl/maplibre";
import type { MapViewState } from "@deck.gl/core";

//Geocoding stuffs
import nlp from "compromise";
import cities from "./assets/cities.json";
import countries from "world-countries";
import contextClues from "./assets/contextClues.json";
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

//OOP
type GeoArticle = {
  lat: number;
  lng: number;
  city: string;
  feedProvider: typeof rssNewsProviders[0] | undefined;
  providerIcon: string;
  countryFlag?: string;
  article: {
    title: string;
    link: string;
    description: string;
    content: string;
    pubDate: string;
  };
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
    c => c.name.common.toLowerCase() === countryName.toLowerCase()
  );
  if (!country) return null;
  const capital = getLocationFromCity(country.capital[0]);
  if (!capital) return null;
  return [capital.lat, capital.lon];
}

//RSS Shenanigans

const PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${url}`,
];

async function fetchWithFallback(url: string): Promise<string> {
  for (const proxy of PROXIES) {
    try {
      const response = await fetch(proxy(url), { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const text = await response.text();
      // allorigins returns JSON with contents field
      try {
        const json = JSON.parse(text);
        if (json.contents) return json.contents;
      } catch {
        // corsproxy returns raw XML directly
      }
      return text;
    } catch {
      continue;
    }
  }
  throw new Error(`All proxies failed for ${url}`);
}

async function fetchAndParseRSS(provider: typeof rssNewsProviders[0]): Promise<GeoArticle[]> {
  const xmlText = await fetchWithFallback(provider.link);

  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'text/xml');
  const items = Array.from(xml.querySelectorAll('item'));
  const providerIcon = xml.querySelector('image url')?.textContent ?? '';
  const articles: GeoArticle[] = [];

  for (const item of items) {
    const title    = item.querySelector('title')?.textContent ?? '';
    const link     = item.querySelector('link')?.textContent ?? '';
    const description = item.querySelector('description')?.textContent ?? '';
    const content  = item.querySelector('content\\:encoded, encoded')?.textContent ?? '';
    const pubDate  = item.querySelector('pubDate')?.textContent ?? '';

    let foundLocations: { name: string; score: number }[] = [];

    const titleDoc       = nlp(title);
    const descriptionDoc = nlp(description + '; ' + content);

    titleDoc.places().normalize({ preset: 'heavy' }).dehyphenate().remove('#Verb')
      .out('array').forEach((place: string) => {
        const n = place.toLowerCase()
          .replaceAll("'s", "").replaceAll("'s", "")
          .replaceAll(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();
        foundLocations.push(weightedLocation(n, 5));
      });

    descriptionDoc.places().normalize({ preset: 'heavy' }).dehyphenate().remove('#Verb')
      .out('array').forEach((place: string) => {
        const n = place.toLowerCase()
          .replaceAll("'s", "").replaceAll("'s", "")
          .replaceAll(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();
        foundLocations.push(weightedLocation(n, 1));
      });

    for (const clue of contextCluesMap) {
      if (title.toLowerCase().includes(clue.name.toLowerCase()))
        foundLocations.push(weightedLocation(clue.location.toLowerCase(), clue.score * 10));
      if (description.toLowerCase().includes(clue.name.toLowerCase()) ||
          content.toLowerCase().includes(clue.name.toLowerCase()))
        foundLocations.push(weightedLocation(clue.location.toLowerCase(), clue.score));
    }

    const finalScores: { [key: string]: number } = {};
    for (const loc of foundLocations) {
      finalScores[loc.name] = (finalScores[loc.name] ?? 0) + loc.score;
    }

    if (Object.keys(finalScores).length === 0) continue;

    const bestLocation = Object.keys(finalScores).reduce((a, b) =>
      finalScores[a] > finalScores[b] ? a : b
    );

    let cityData = getLocationFromCity(bestLocation);

    if (!cityData) {
      const countryData = countries.find(
        c => c.name.common.toLowerCase().trim() === bestLocation.toLowerCase().trim()
      );
      if (countryData) cityData = getLocationFromCity(countryData.capital[0]);
    }

    if (!cityData) continue;

    articles.push({
      lat: cityData.lat,
      lng: cityData.lon,
      city: cityData.name,
      countryFlag: (cityData as any).flag,
      feedProvider: provider,
      providerIcon,
      article: { title, link, description, content, pubDate },
    });
  }

  return articles;
}

const rssNewsProviders = rssNews

function App() {
  //Fetch a bunch of rss feeds and display them on the map with markers. When you click on a marker, it should show a popup with the title of the news article and a link to the article.

  //First fetch the content of the preconfigured rss providers' urls and convert them to json using rss2json api.
  const rssFeeds = rssNewsProviders.map((provider) => provider.link);
  let rssJson: any[] = [];
  const [geomarkedArticles, setGeomarkedArticles] = useState<GeoArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAllFeeds() {
      const results = await Promise.allSettled(
        rssNewsProviders.map(provider => fetchAndParseRSS(provider))
      );

      const articles: GeoArticle[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          articles.push(...result.value);
        }
      }

      setGeomarkedArticles(articles);
      setLoading(false);
    }

    fetchAllFeeds();
  }, []);

  // console.log(rssJson);
  //Then extract the location using context clues

  for (let feed of rssJson) {
    const feedProvider = rssNewsProviders.find((provider) => provider.link === feed.feed.url);
    const providerIcon = feed.feed.image;
    console.log(feed, feedProvider);
    for (let article of feed.items) {
      let foundLocations: { name: string; score: number }[] = [];

      //First check if the title and description already has a city in it

      let titleDoc = nlp(article.title);
      let descriptionDoc = nlp(article.description + "; " + article.content);

      titleDoc
        .places()
        .normalize({ preset: "heavy" })
        .dehyphenate()
        .remove("#Verb")
        .out("array")
        .forEach((place: string) => {
          let normalizedPlace = place
            .toLowerCase()
            .replaceAll("’s", "")
            .replaceAll("'s", "")
            .replaceAll(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
            .trim();
          foundLocations.push(weightedLocation(normalizedPlace, 5));
          // console.log(normalizedPlace);
        });
      descriptionDoc
        .places()
        .normalize({ preset: "heavy" })
        .dehyphenate()
        .remove("#Verb")
        .out("array")
        .forEach((place: string) => {
          let normalizedPlace = place
            .toLowerCase()
            .replaceAll("’s", "")
            .replaceAll("'s", "")
            .replaceAll(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
            .trim();
          foundLocations.push(weightedLocation(normalizedPlace, 1));
          // console.log(normalizedPlace);
        });
      // console.log(foundLocations);

      //Check if it has any context clues in it
      for (let clue of contextCluesMap) {
        if (article.title.toLowerCase().includes(clue.name.toLowerCase())) {
          foundLocations.push(
            weightedLocation(clue.location.toLowerCase(), clue.score * 10),
          );
        }
        if (
          article.description.toLowerCase().includes(clue.name.toLowerCase()) ||
          article.content.toLowerCase().includes(clue.name.toLowerCase())
        ) {
          foundLocations.push(
            weightedLocation(clue.location.toLowerCase(), clue.score),
          );
        }
      }

      //Tally up the locations, duplicates should have their scores added together
      let finalLocationScores: { [key: string]: number } = {};
      for (let location of foundLocations) {
        if (finalLocationScores[location.name]) {
          finalLocationScores[location.name] += location.score;
        } else {
          finalLocationScores[location.name] = location.score;
        }
      }
      // console.log(article.title);
      // console.log(finalLocationScores);
      if (Object.keys(finalLocationScores).length > 0) {
        //Check if location is actually a city and get its coordinates
        let bestLocation = Object.keys(finalLocationScores).reduce((a, b) =>
          finalLocationScores[a] > finalLocationScores[b] ? a : b,
        );
        let cityData = getLocationFromCity(bestLocation);
        if (cityData) {
          geomarkedArticles.push({
            lat: cityData.lat,
            lng: cityData.lon,
            city: cityData.name,
            article: article,
            feedProvider: feedProvider,
            providerIcon: providerIcon,
            countryFlag: cityData.flag,
          });
          continue;
        }

        //If here, it means that the best location could be a country. Try to find the coordinates of the capital
        let countryData = countries.find(
          (country) =>
            country.name.common.toLowerCase().trim() ===
            bestLocation.toLowerCase().trim(),
        );
        if (countryData) {
          let capital = countryData.capital[0];

          let cityData = getLocationFromCity(capital);
          if (cityData) {

            geomarkedArticles.push({
              lat: cityData.lat,
              lng: cityData.lon,
              city: cityData.name,
              article: article,
              feedProvider: feedProvider,
              providerIcon: providerIcon,
              countryFlag: cityData.flag,
            });
            continue;
          }
        }

        //If here then the article has a location that we can't find, so we skip it
        console.log(
          "Could not find location for article: " +
          article.title +
          ". Best guess was: " +
          bestLocation,
        );
      }
    }
  }

  console.log(geomarkedArticles);

  // Group geomarked articles by location
  const locationGroups = geomarkedArticles.reduce(
    (groups, item) => {
      const key = `${item.lat.toFixed(2)},${item.lng.toFixed(2)}`;
      if (!groups[key]) {
        groups[key] = { lat: item.lat, lng: item.lng, articles: [], city: item.city, countryFlag: item.countryFlag };
      }
      groups[key].articles.push({...item.article,
          feedProvider: item.feedProvider,
          providerIcon: item.providerIcon,
      });
      return groups;
    },
    {} as Record<string, { 
      lat: number; 
      lng: number; 
      articles: any[]; 
      city: string 
      countryFlag?: string;
    }>,
  );

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

  const groupedMarkers = Object.values(locationGroups);

  const handleHover = useCallback(({ object, x, y }: any) => {
    setHoverInfo(object ? { x, y, object } : null);
  }, []);

  const handleClick = useCallback(({ object }: any) => {
    if (object) setSelectedGroup(object);
  }, []);

  const heatmapLayer = useMemo(
    () =>
      new HeatmapLayer({
        id: "news-heat",
        data: groupedMarkers,
        getPosition: (d) => [d.lat, d.lng],
        getWeight: (d: { articles: string | any[]; }) => Math.log(d.articles.length)+1,
        radiusPixels: 120,
        intensity: 1.5,
        threshold: 0.000001,
        aggregation: "SUM",
        debounce: 100,
        colorRange: [
          [255, 68, 68, 0],
          [255, 68, 68, 80],
          [255, 100, 50, 160],
          [255, 140, 30, 200],
          [255, 200, 0, 230],
          [255, 255, 255, 255],
        ],
      }),
    [groupedMarkers],
  );

  const scatterLayer = useMemo(
    () =>
      new ScatterplotLayer({
        id: "news-scatter",
        data: groupedMarkers,
        getPosition: (d) => [d.lat, d.lng],
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
    [groupedMarkers, selectedGroup, handleClick, handleHover],
  );

  const arcLayer = useMemo(() => new ArcLayer({
    id: 'news-arc',
    data: arcData ? [arcData] : [],
    getSourcePosition: d => d.sourcePosition,
    getTargetPosition: d => d.targetPosition,
    getSourceColor: [0, 216, 116, 255],   // your yellow
    getTargetColor: [0, 68, 68, 255],
    getWidth: 2,
    greatCircle: true,
  }), [arcData]);

  return (
    <div className="bg-[#0d0d0d] overflow-hidden" style={{fontFamily: "Montagu Slab, sans-serif"}}>
      {/* Header - fixed, floats above canvas */}
      <div className="fixed top-[2vh] left-[2vw] w-[96vw] h-[9vh] bg-[#1a1a1a] rounded-lg flex items-center px-6 z-[999] border border-[#F4D874]">
        <span className="text-green-300 text-xl tracking-tight mr-4 bg-green-300/20 px-2 py-1 rounded">
          🌍
        </span>
        <span className="text-white text-3xl tracking-tight">
          What's going on?
        </span>
      </div>

      {/* Map fills entire screen */}
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={[heatmapLayer, scatterLayer, arcLayer]}
        style={{ width: "98vw", height: "98vh", marginTop: "1vh", marginLeft: "1vw" }}
        onClick={({ object }) => {
          if (!object) setSelectedGroup(null);
        }}
      >
        <Map mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" />
      </DeckGL>

      {/* Tooltip - fixed to cursor */}
      {hoverInfo && (
        <div
          className="fixed pointer-events-none z-[1000] bg-[#111] border border-[#2a2a2a] rounded-lg p-3 max-w-[220px]"
          style={{ left: hoverInfo.x + 14, top: hoverInfo.y + 14 }}
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
        <div className="fixed right-[1vw] top-[12vh] h-[86vh] w-[40vw] rounded-lg bg-[#111] border border-[#F4D874] p-6 z-[999] text-white">
          <h2 className="text-[#F4D874] text-2xl tracking-widest uppercase mb-1 font-bold">
            {selectedGroup.countryFlag} {selectedGroup.city}
          </h2>
          <div className="overflow-y-auto h-full p-2 border-t border-[#2a2a2a]">
            {selectedGroup.articles.map((article, index) => (
              <div key={index} 
              className="mb-4 p-3 rounded-lg border border-[#2a2a2a] hover:border-[#F4D874] transition-colors"
              onMouseEnter={() => {
                const providerCoords = getCountryCapitalCoords(
                  article.feedProvider?.originCountry ?? ''
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
                    <span className="text-[11px] text-[#666]">
                      {article.feedProvider?.name ?? 'Unknown'}, {article.feedProvider?.originCountry ?? ''}
                    </span>
                    <a 
                      href={article.link} 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-sm text-[#eee] leading-snug hover:text-[#F4D874] transition-colors"
                    >
                      {article.title}
                    </a>
                    <p className="text-[10px] text-[#444]">{article.pubDate?.slice(0, 10)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer information */}
      <div className="fixed bottom-2 left-2 w-[20vw] h-[5vh] flex items-center justify-center px-6 z-[999]">
        <span className="text-[#aaa] text-xs tracking-wide">
          Geo-marked articles: {geomarkedArticles.length} <br/>
          RSS feeds: {rssNewsProviders.length}
        </span>
      </div>
    </div>
  );
}

export default App;
