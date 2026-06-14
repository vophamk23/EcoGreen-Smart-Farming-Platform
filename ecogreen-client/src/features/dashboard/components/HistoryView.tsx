"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Activity,
  Cpu,
  Droplets,
  Loader2,
  RefreshCcw,
  Thermometer,
  Waves,
  Wind,
  Clock,
  Database,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Minus
} from "lucide-react";
import { getDevices, getSensorReadings } from "@/services/device.service";
import type { Device, Sensor } from "@/types";
import { useLanguage } from "@/context/LanguageContext";
import { ExportReportCard } from "./ExportReportCard";

type MetricKey = "temp" | "humi" | "soil" | "light";

interface ChartPoint {
  recordedAt: string;
  time: string;
  temp?: number;
  humi?: number;
  soil?: number;
  light?: number;
}

interface ReadingLike {
  value: number | string;
  recorded_at?: string;
  recordedAt?: string;
  created_at?: string;
}

const metricConfig: Record<
  MetricKey,
  { label: string; unit: string; color: string }
> = {
  temp: { label: "Nhiệt độ", unit: "°C", color: "#ef4444" },
  humi: { label: "Độ ẩm không khí", unit: "%", color: "#0ea5e9" }, // sky blue
  soil: { label: "Độ ẩm đất", unit: "%", color: "#10b981" }, // emerald green
  light: { label: "Ánh sáng", unit: "lux", color: "#f59e0b" }, // amber yellow
};

function normalizeText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getSensorMetric(sensor: Sensor): MetricKey | null {
  const haystack = `${normalizeText(sensor.type)} ${normalizeText(sensor.name)}`;

  if (haystack.includes("soil") || haystack.includes("dat") || haystack.includes("đất")) {
    return "soil";
  }

  if (haystack.includes("light") || haystack.includes("lux") || haystack.includes("sáng")) {
    return "light";
  }

  if (haystack.includes("temp") || haystack.includes("nhiệt") || haystack.includes("nhiet")) {
    return "temp";
  }

  if (
    haystack.includes("humi") ||
    haystack.includes("humidity") ||
    haystack.includes("ẩm") ||
    haystack.includes("không khí")
  ) {
    return "humi";
  }

  return null;
}

function formatTime(value: string, timeRange: "day" | "week" | "month", locale: string = "vi-VN") {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  if (timeRange === "day") {
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString(locale, {
    month: "numeric",
    day: "numeric",
  }) + " " + date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFullTime(value?: string | null, locale: string = "vi-VN") {
  if (!value) {
    return locale === "vi-VN" ? "Chưa có dữ liệu" : "No data";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return locale === "vi-VN" ? "Chưa có dữ liệu" : "No data";
  }

  return date.toLocaleString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function toNumber(value: unknown) {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

  return Number.isFinite(parsed) ? Number(parsed.toFixed(1)) : undefined;
}

function getReadingTime(reading: ReadingLike) {
  return (
    reading.recorded_at ??
    reading.recordedAt ??
    reading.created_at ??
    new Date().toISOString()
  );
}

function buildHistoryPoints(
  readingsByMetric: Partial<Record<MetricKey, ReadingLike[]>>,
  timeRange: "day" | "week" | "month",
  locale: string = "vi-VN"
) {
  const byTime = new Map<string, ChartPoint>();

  Object.entries(readingsByMetric).forEach(([metric, readings]) => {
    readings?.forEach((reading) => {
      const value = toNumber(reading.value);

      if (value === undefined) {
        return;
      }

      const recordedAt = getReadingTime(reading);
      const current = byTime.get(recordedAt) ?? {
        recordedAt,
        time: formatTime(recordedAt, timeRange, locale),
      };

      byTime.set(recordedAt, {
        ...current,
        [metric]: value,
      });
    });
  });

  return Array.from(byTime.values()).sort(
    (left, right) =>
      new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime()
  );
}

interface HsTooltipEntry {
  dataKey: string;
  stroke?: string;
  value: number;
  name: string;
  payload: { recordedAt: string };
}

interface HsTooltipProps {
  active?: boolean;
  payload?: HsTooltipEntry[];
}

const CustomTooltip = ({ active, payload }: HsTooltipProps) => {
  const { language, t, tempUnit } = useLanguage();
  const locale = language === "vi" ? "vi-VN" : "en-US";
  if (active && payload && payload.length) {
    return (
      <div className="hs-tooltip">
        <div className="hs-tooltip-header">
          <Clock size={12} />
          <span>{formatFullTime(payload[0].payload.recordedAt, locale)}</span>
        </div>
        <div className="hs-tooltip-divider" />
        <div className="hs-tooltip-body">
          {payload.map((entry: HsTooltipEntry) => {
            const config = metricConfig[entry.dataKey as MetricKey];
            return (
              <div key={entry.dataKey} className="hs-tooltip-row">
                <span className="hs-tooltip-dot" style={{ backgroundColor: entry.stroke || config?.color }} />
                <span className="hs-tooltip-label">
                  {config ? t("history.metrics." + (entry.dataKey as MetricKey), config.label) : entry.name}:
                </span>
                <span className="hs-tooltip-val">
                  {entry.value} {entry.dataKey === "temp" ? `°${tempUnit}` : config?.unit}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
};

export function HistoryView() {
  const { language, t, formatTemp, tempUnit, convertTemp } = useLanguage();
  const locale = language === "vi" ? "vi-VN" : "en-US";
  const [isMounted, setIsMounted] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [timeRange, setTimeRange] = useState<"day" | "week" | "month">("day");
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | MetricKey>("all");

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    let mounted = true;

    getDevices()
      .then((nextDevices) => {
        if (!mounted) {
          return;
        }
        setDevices(nextDevices);
        setSelectedDeviceId((current) => current || nextDevices[0]?.Device_ID || "");
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : t("history.failedDevices", "Không tải được thiết bị"));
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.Device_ID === selectedDeviceId),
    [devices, selectedDeviceId]
  );

  const metricSensors = useMemo(() => {
    const sensors = selectedDevice?.sensors ?? [];
    const next: Partial<Record<MetricKey, Sensor>> = {};

    sensors.forEach((sensor) => {
      const metric = getSensorMetric(sensor);
      if (metric && !next[metric]) {
        next[metric] = sensor;
      }
    });

    return next;
  }, [selectedDevice]);

  const maxLimit = 2000;

  useEffect(() => {
    let mounted = true;

    if (!selectedDevice) {
      setPoints([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const loadHistory = async () => {
      try {
        const now = new Date();
        let startDate: string | undefined;

        if (timeRange === "day") {
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        } else if (timeRange === "week") {
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        } else if (timeRange === "month") {
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        }

        const entries = await Promise.all(
          (Object.entries(metricSensors) as [MetricKey, Sensor][]).map(
            async ([metric, sensor]) => {
              const readings = await getSensorReadings(sensor.Sensor_ID, maxLimit, startDate);
              return [metric, readings] as const;
            }
          )
        );

        if (!mounted) {
          return;
        }

        setPoints(
          buildHistoryPoints(Object.fromEntries(entries), timeRange, locale).slice(-maxLimit)
        );
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : t("history.failedHistory", "Không tải được dữ liệu lịch sử")
          );
          setPoints([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      mounted = false;
    };
  }, [selectedDevice, metricSensors, timeRange, locale]);

  const latestAt = points.at(-1)?.recordedAt;

  const convertedPoints = useMemo(() => {
    if (tempUnit === "F") {
      return points.map((p) => ({
        ...p,
        temp: p.temp !== undefined ? Number((p.temp * 1.8 + 32).toFixed(1)) : undefined,
      }));
    }
    return points;
  }, [points, tempUnit]);

  // Tính toán thống kê động từ dữ liệu đã tải
  const stats = useMemo(() => {
    if (points.length === 0) return { temp: 0, humi: 0, soil: 0, light: 0 };
    let tempSum = 0, tempCount = 0;
    let humiSum = 0, humiCount = 0;
    let soilSum = 0, soilCount = 0;
    let lightSum = 0, lightCount = 0;

    points.forEach((p) => {
      if (typeof p.temp === "number") { tempSum += p.temp; tempCount++; }
      if (typeof p.humi === "number") { humiSum += p.humi; humiCount++; }
      if (typeof p.soil === "number") { soilSum += p.soil; soilCount++; }
      if (typeof p.light === "number") { lightSum += p.light; lightCount++; }
    });

    return {
      temp: tempCount > 0 ? (tempSum / tempCount) : 0,
      humi: humiCount > 0 ? (humiSum / humiCount) : 0,
      soil: soilCount > 0 ? (soilSum / soilCount) : 0,
      light: lightCount > 0 ? (lightSum / lightCount) : 0,
    };
  }, [points]);

  return (
    <div className="hs-container">
      {/* Device Selector Card */}
      <section className="hs-header">
        <div className="hs-header-left">
          <span className="hs-badge-pill">
            <Database size={13} />
            {t("history.sensorHistory", "Lịch sử cảm biến")}
          </span>
          <h1 className="hs-title">{t("history.title", "Phân tích dữ liệu lịch sử")}</h1>
          <p className="hs-subtitle">
            {t("history.subtitle", "Truy xuất nhật ký đo đạc của các cảm biến theo từng thiết bị và chu kỳ thời gian.")}
          </p>
        </div>
        <div className="hs-header-actions">
          <div className="hs-action-group">
            <span className="hs-action-label">{t("history.selectDevice", "Chọn thiết bị ESP")}</span>
            <select
              value={selectedDeviceId}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              className="hs-select"
            >
              {devices.map((device) => (
                <option key={device.Device_ID} value={device.Device_ID}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Export Report Section */}
      {selectedDevice && (
        <section className="hs-export-section">
          <ExportReportCard
            deviceId={selectedDevice.Device_ID}
            deviceName={selectedDevice.name}
          />
        </section>
      )}

      {/* Chart Panel (Full Width) */}
      <section className="hs-panel">
        <div className="hs-panel-header">
          <div className="hs-panel-title-area">
            <h2 className="hs-panel-title">
              <Activity size={18} style={{ color: "#10b981" }} />
              {t("history.chartTitle", "Biểu đồ diễn biến cảm biến")}
            </h2>
            <p className="hs-panel-subtitle">
              {latestAt ? t("history.lastUpdated", "Cập nhật lần cuối: {time}").replace("{time}", formatFullTime(latestAt, locale)) : t("history.monitorTooltip", "Theo dõi các thông số cảm biến theo thời gian")}
            </p>
          </div>

          {/* Time Range Buttons */}
          <div className="hs-range-group">
            {(["day", "week", "month"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`hs-range-btn ${timeRange === range ? "hs-range-btn--active" : ""}`}
              >
                {range === "day" ? t("history.range.day", "Ngày") : range === "week" ? t("history.range.week", "Tuần") : t("history.range.month", "Tháng")}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Selector */}
        <div className="hs-tabs">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`hs-tab-btn ${
              activeTab === "all" ? "hs-tab-btn--all-active" : "hs-tab-btn--all"
            }`}
          >
            {t("history.allSensors", "Tất cả cảm biến")}
          </button>
          {(Object.keys(metricConfig) as MetricKey[]).map((metric) => {
            const active = activeTab === metric;
            return (
              <button
                key={metric}
                type="button"
                onClick={() => setActiveTab(metric)}
                className={`hs-tab-btn ${
                  active ? "hs-tab-btn--metric-active text-white" : "hs-tab-btn--metric"
                }`}
                style={{
                  backgroundColor: active ? metricConfig[metric].color : undefined,
                }}
              >
                <span
                  className="hs-tab-dot"
                  style={{
                    backgroundColor: active ? "white" : metricConfig[metric].color,
                  }}
                />
                {t("history.metrics." + metric, metricConfig[metric].label)} ({metric === "temp" ? "°" + tempUnit : metricConfig[metric].unit})
              </button>
            );
          })}
        </div>

        {/* Chart Drawing Area */}
        <div className="h-[520px] min-w-0" style={{ marginTop: "0.5rem" }}>
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400 gap-2">
              <RefreshCcw size={16} className="animate-spin" />
              {t("history.loadingChart", "Đang tải biểu đồ lịch sử...")}
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <RefreshCcw size={28} className="text-red-400" />
              <p className="max-w-md text-sm font-semibold text-red-500">
                {error}
              </p>
            </div>
          ) : !isMounted ? (
            <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400 gap-2">
              <RefreshCcw size={16} className="animate-spin" />
              {t("history.initializingChart", "Đang khởi tạo biểu đồ...")}
            </div>
          ) : points.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Activity size={30} className="text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">
                {t("history.noData", "Chưa có dữ liệu lịch sử cho thiết bị này.")}
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={convertedPoints}
                margin={{ left: 5, right: 10, top: 12, bottom: 8 }}
              >
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={true} horizontal={true} />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                  tickLine={{ stroke: "#cbd5e1" }}
                  axisLine={{ stroke: "#cbd5e1", strokeWidth: 1.5 }}
                  minTickGap={40}
                  dy={8}
                />
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  domain={
                    activeTab === "temp"
                      ? tempUnit === "F" ? [32, 113] : [0, 45]
                      : activeTab === "all" || activeTab === "humi" || activeTab === "soil"
                        ? [0, 100]
                        : ["auto", "auto"]
                  }
                  tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                  tickLine={{ stroke: "#cbd5e1" }}
                  axisLine={{ stroke: "#cbd5e1", strokeWidth: 1.5 }}
                  tickFormatter={(value) => {
                    if (activeTab === "temp") return `${value}°${tempUnit}`;
                    if (activeTab === "humi" || activeTab === "soil") return `${value}%`;
                    if (activeTab === "light") return `${value} lux`;
                    return `${value}`;
                  }}
                  width={activeTab === "light" ? 60 : 45}
                />
                {activeTab === "all" && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                    tickLine={{ stroke: "#cbd5e1" }}
                    axisLine={{ stroke: "#cbd5e1", strokeWidth: 1.5 }}
                    tickFormatter={(value) => `${value} lux`}
                    width={60}
                  />
                )}
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  verticalAlign="top" 
                  height={36} 
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, fontWeight: 700, paddingBottom: 15 }} 
                />
                {(Object.keys(metricConfig) as MetricKey[])
                  .filter((m) => activeTab === "all" || activeTab === m)
                  .map((metric) => (
                    <Line
                      key={metric}
                      type="monotone"
                      dataKey={metric}
                      yAxisId={activeTab === "all" ? (metric === "light" ? "right" : "left") : "left"}
                      name={`${t("history.metrics." + metric, metricConfig[metric].label)} (${metric === "temp" ? "°" + tempUnit : metricConfig[metric].unit})`}
                      stroke={metricConfig[metric].color}
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ r: 6, stroke: "#ffffff", strokeWidth: 2, fill: metricConfig[metric].color }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Bottom Panels (Side-by-Side Grid) */}
      <section className="hs-bottom-grid">
        {/* Quick Statistics */}
        <div className="hs-side-card">
          <h3 className="hs-side-title">
            <TrendingUp size={16} style={{ display: "inline-block", marginRight: 6, verticalAlign: "middle", color: "#64748b" }} />
            {t("history.averageValues", "Trị số trung bình ({range})").replace("{range}", timeRange === "day" ? t("history.ranges.day", "Hôm nay") : timeRange === "week" ? t("history.ranges.week", "Tuần này") : t("history.ranges.month", "Tháng này"))}
          </h3>
          <div className="hs-info-list">
            <StatRow
              icon={<Thermometer size={16} />}
              label={t("history.avgTemp", "Nhiệt độ TB")}
              value={formatTemp(stats.temp)}
              trend={stats.temp > 28 ? "up" : stats.temp < 20 ? "down" : "stable"}
              color="#ef4444"
            />
            <StatRow
              icon={<Wind size={16} />}
              label={t("history.avgHumi", "Độ ẩm khí TB")}
              value={`${stats.humi.toFixed(0)}%`}
              trend={stats.humi > 80 ? "up" : stats.humi < 50 ? "down" : "stable"}
              color="#0ea5e9"
            />
            <StatRow
              icon={<Droplets size={16} />}
              label={t("history.avgSoil", "Độ ẩm đất TB")}
              value={`${stats.soil.toFixed(0)}%`}
              trend={stats.soil > 70 ? "up" : stats.soil < 35 ? "down" : "stable"}
              color="#10b981"
            />
            <StatRow
              icon={<Waves size={16} />}
              label={t("history.avgLight", "Ánh sáng TB")}
              value={`${stats.light.toFixed(0)} lux`}
              trend={stats.light > 800 ? "up" : stats.light < 200 ? "down" : "stable"}
              color="#f59e0b"
            />
          </div>
        </div>

        {/* Threshold ranges */}
        <div className="hs-side-card">
          <h3 className="hs-side-title">
            <ShieldCheck size={16} style={{ display: "inline-block", marginRight: 6, verticalAlign: "middle", color: "#64748b" }} />
            {t("history.safeThresholds", "Ngưỡng sinh trưởng an toàn")}
          </h3>
          <div className="hs-sensor-list">
            <ThresholdRow
              label={t("history.metrics.temp", "Nhiệt độ")}
              min={Math.round(convertTemp(18))}
              max={Math.round(convertTemp(32))}
              unit={`°${tempUnit}`}
            />
            <ThresholdRow label={t("history.metrics.humi", "Độ ẩm không khí")} min={45} max={85} unit="%" />
            <ThresholdRow label={t("history.metrics.soil", "Độ ẩm đất")} min={35} max={75} unit="%" />
            <ThresholdRow label={t("history.metrics.light", "Cường độ ánh sáng")} min={400} max={1200} unit="lux" />
          </div>
        </div>
      </section>

      {/* Styled JSX layout */}
      <style jsx global>{`
        .hs-container {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          font-family: inherit;
        }

        /* ===== Header / Welcome Banner ===== */
        .hs-header {
          background: white;
          border-radius: 24px;
          border: 1.5px solid #e2e8f0;
          padding: 1.75rem 2rem;
          box-shadow: 0 4px 20px rgba(0,0,0,0.02);
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        @media (min-width: 1024px) {
          .hs-header {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
          }
        }

        .hs-header-left {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .hs-badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.25rem 0.75rem;
          border-radius: 100px;
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border: 1px solid rgba(16, 185, 129, 0.15);
          background: rgba(16, 185, 129, 0.08);
          color: #10b981;
          width: fit-content;
        }

        .hs-title {
          font-size: 1.875rem;
          font-weight: 850;
          color: #0f172a;
          letter-spacing: -0.02em;
          margin: 0;
        }

        .hs-subtitle {
          font-size: 0.875rem;
          color: #64748b;
          margin: 0;
        }

        .hs-header-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .hs-action-group {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .hs-action-label {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          color: #64748b;
          letter-spacing: 0.05em;
          margin-left: 0.1rem;
        }

        .hs-select {
          height: 2.75rem;
          min-width: 15rem;
          border-radius: 12px;
          border: 1.5px solid #cbd5e1;
          background-color: white;
          padding: 0 1rem;
          font-size: 0.85rem;
          font-weight: 650;
          color: #1e293b;
          outline: none;
          cursor: pointer;
          transition: all 0.2s;
        }

        .hs-select:hover {
          border-color: #94a3b8;
        }

        .hs-select:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
        }

        /* ===== Bottom Grid Layout ===== */
        .hs-bottom-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }

        @media (min-width: 768px) {
          .hs-bottom-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        /* Panel details */
        .hs-panel {
          background: white;
          border-radius: 24px;
          border: 1.5px solid #e2e8f0;
          padding: 1.5rem;
          box-shadow: 0 4px 20px rgba(0,0,0,0.02);
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          min-width: 0;
        }

        .hs-panel-header {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          justify-content: space-between;
          border-b: 1.5px dashed #f1f5f9;
          padding-bottom: 1.25rem;
        }

        @media (min-width: 640px) {
          .hs-panel-header {
            flex-direction: row;
            align-items: center;
          }
        }

        .hs-panel-title-area {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .hs-panel-title {
          font-size: 1.15rem;
          font-weight: 800;
          color: #0f172a;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .hs-panel-subtitle {
          font-size: 0.8rem;
          color: #94a3b8;
          margin: 0;
          font-weight: 550;
        }

        /* Range Selector Buttons */
        .hs-range-group {
          display: flex;
          background: #f1f5f9;
          border-radius: 10px;
          padding: 0.25rem;
          align-self: flex-start;
        }

        .hs-range-btn {
          border: none;
          background: transparent;
          font-size: 0.8rem;
          font-weight: 700;
          color: #64748b;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .hs-range-btn:hover {
          color: #334155;
        }

        .hs-range-btn--active {
          background: white;
          color: #10b981 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.04);
        }

        /* Metric Tabs */
        .hs-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          border-bottom: 1.5px solid #f1f5f9;
          padding-bottom: 1rem;
        }

        .hs-tab-btn {
          border: 1.5px solid #e2e8f0;
          border-radius: 12px;
          padding: 0.5rem 1rem;
          font-size: 0.75rem;
          font-weight: 750;
          cursor: pointer;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }

        .hs-tab-btn--all {
          background: #f8fafc;
          color: #475569;
        }

        .hs-tab-btn--all:hover {
          background: #f1f5f9;
          border-color: #cbd5e1;
        }

        .hs-tab-btn--all-active {
          background: #0f172a;
          color: white;
          border-color: #0f172a;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
        }

        .hs-tab-btn--metric {
          background: white;
          color: #64748b;
        }

        .hs-tab-btn--metric:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
        }

        .hs-tab-btn--metric-active {
          border-color: transparent;
          box-shadow: 0 4px 14px rgba(0,0,0,0.08);
        }

        .hs-tab-dot {
          width: 6px;
          height: 6px;
          border-radius: 100px;
          display: inline-block;
        }

        /* ===== Custom Tooltip ===== */
        .hs-tooltip {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(12px);
          border-radius: 16px;
          border: 1.5px solid #e2e8f0;
          padding: 0.85rem 1rem;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          min-width: 170px;
        }

        .hs-tooltip-header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.72rem;
          font-weight: 750;
          color: #64748b;
        }

        .hs-tooltip-divider {
          height: 1px;
          background: #e2e8f0;
        }

        .hs-tooltip-body {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }

        .hs-tooltip-row {
          display: flex;
          align-items: center;
          font-size: 0.78rem;
          gap: 0.5rem;
        }

        .hs-tooltip-dot {
          width: 7px;
          height: 7px;
          border-radius: 100px;
        }

        .hs-tooltip-label {
          color: #475569;
          font-weight: 600;
        }

        .hs-tooltip-val {
          margin-left: auto;
          color: #0f172a;
          font-weight: 750;
        }

        /* ===== Sidebar panels ===== */
        .hs-sidebar {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .hs-side-card {
          background: white;
          border-radius: 24px;
          border: 1.5px solid #e2e8f0;
          padding: 1.5rem;
          box-shadow: 0 4px 20px rgba(0,0,0,0.02);
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .hs-side-title {
          font-size: 0.85rem;
          font-weight: 800;
          color: #1e293b;
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          border-bottom: 1.5px solid #f8fafc;
          padding-bottom: 0.75rem;
        }

        .hs-info-list, .hs-sensor-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        /* ===== Export Section ===== */
        .hs-export-section {
          width: 100%;
        }

        /* ===== Export Report Card (shared) ===== */
        .export-card {
          background: white;
          border-radius: 16px;
          border: 1.5px solid #e2e8f0;
          overflow: hidden;
          box-shadow: 0 2px 12px rgba(0,0,0,0.04);
          transition: box-shadow 0.2s ease;
        }
        .export-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        .export-card__header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 1rem 1.25rem; cursor: pointer; user-select: none;
        }
        .export-card__header-left { display: flex; align-items: center; gap: 0.75rem; }
        .export-card__icon-wrap {
          width: 36px; height: 36px;
          background: linear-gradient(135deg, #1a7f4b, #22c55e);
          border-radius: 10px; display: flex; align-items: center;
          justify-content: center; color: white; flex-shrink: 0;
        }
        .export-card__title { font-size: 0.9rem; font-weight: 700; color: #0f172a; margin: 0; }
        .export-card__subtitle { font-size: 0.73rem; color: #94a3b8; margin: 0; font-weight: 500; }
        .export-card__toggle-btn {
          background: none; border: none; cursor: pointer; color: #94a3b8;
          padding: 4px; border-radius: 6px; display: flex; transition: background 0.15s;
        }
        .export-card__toggle-btn:hover { background: #f1f5f9; color: #475569; }
        .export-card__body {
          padding: 0 1.25rem 1.25rem; border-top: 1px solid #f1f5f9;
          display: flex; flex-direction: column; gap: 0.85rem;
        }
        .export-card__presets { display: flex; gap: 0.4rem; flex-wrap: wrap; padding-top: 0.85rem; }
        .export-card__preset-btn {
          background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 20px;
          padding: 3px 10px; font-size: 0.72rem; font-weight: 600; color: #475569;
          cursor: pointer; transition: all 0.15s;
        }
        .export-card__preset-btn:hover { background: #dcfce7; border-color: #86efac; color: #15803d; }
        .export-card__date-row { display: flex; align-items: center; gap: 0.5rem; }
        .export-card__date-group { flex: 1; display: flex; flex-direction: column; gap: 0.2rem; }
        .export-card__date-label {
          font-size: 0.7rem; font-weight: 600; color: #94a3b8;
          display: flex; align-items: center; gap: 3px;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .export-card__date-input {
          border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 6px 8px;
          font-size: 0.78rem; font-weight: 600; color: #0f172a;
          background: #f8fafc; width: 100%; outline: none; transition: border-color 0.15s;
        }
        .export-card__date-input:focus { border-color: #22c55e; background: white; }
        .export-card__date-sep { color: #94a3b8; font-weight: 700; font-size: 1rem; margin-top: 16px; }
        .export-card__error {
          background: #fef2f2; border: 1px solid #fecaca;
          border-radius: 8px; padding: 8px 12px;
          font-size: 0.78rem; color: #dc2626; font-weight: 500;
        }
        .export-card__actions { display: flex; flex-direction: column; gap: 0.5rem; }
        .export-card__btn {
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          padding: 9px 14px; border-radius: 10px; font-size: 0.82rem; font-weight: 700;
          cursor: pointer; border: none; transition: all 0.18s ease; letter-spacing: 0.01em;
        }
        .export-card__btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .export-card__btn--excel {
          background: #10b981; color: white;
          box-shadow: none;
        }
        .export-card__btn--excel:hover:not(:disabled) {
          background: #059669;
          transform: translateY(-1px);
        }
        .export-card__btn--pdf {
          background: #ef4444; color: white;
          box-shadow: none;
        }
        .export-card__btn--pdf:hover:not(:disabled) {
          background: #dc2626;
          transform: translateY(-1px);
        }
        .export-card__note { font-size: 0.7rem; color: #94a3b8; line-height: 1.5; margin: 0; font-weight: 500; }
      `}</style>
    </div>
  );
}

function StatRow({
  icon,
  label,
  value,
  trend,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend: "up" | "down" | "stable";
  color: string;
}) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2.5">
        <div 
          className="flex items-center justify-center w-8 h-8 rounded-lg"
          style={{ backgroundColor: `${color}10`, color: color }}
        >
          {icon}
        </div>
        <span className="text-xs font-bold text-slate-500">{label}</span>
      </div>
      
      <div className="flex items-center gap-2">
        <span className="text-sm font-extrabold text-slate-800">{value}</span>
        <span className={`flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-bold ${
          trend === "up" ? "bg-red-50 text-red-500" :
          trend === "down" ? "bg-sky-50 text-sky-500" :
          "bg-slate-50 text-slate-400"
        }`}>
          {trend === "up" ? <TrendingUp size={11} /> :
           trend === "down" ? <TrendingDown size={11} /> :
           <Minus size={11} />}
        </span>
      </div>
    </div>
  );
}

function ThresholdRow({
  label,
  min,
  max,
  unit,
}: {
  label: string;
  min: number;
  max: number;
  unit: string;
}) {
  return (
    <div className="flex justify-between items-center py-3 border-b border-slate-100 last:border-0">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <span className="text-xs font-extrabold text-emerald-600 bg-emerald-50/70 border border-emerald-100/50 px-2.5 py-1 rounded-lg">
        {min}{unit} - {max}{unit}
      </span>
    </div>
  );
}
