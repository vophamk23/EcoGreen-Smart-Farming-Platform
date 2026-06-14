"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Droplets,
  RefreshCcw,
  Thermometer,
  Wifi,
  WifiOff,
  Wind,
  Waves,
  Clock,
  Cpu,
  Database,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getDevices, getSensorReadings } from "@/services/device.service";
import type { Device, Sensor } from "@/types";
import { useRealtimeTelemetry } from "@/features/shared/useRealtimeTelemetry";
import type { TelemetrySnapshot } from "@/types/automation";
import { useLanguage } from "@/context/LanguageContext";

type MetricKey = "temp" | "humi" | "soil" | "light";

type ChartPoint = {
  recordedAt: string;
  time: string;
  temp?: number;
  humi?: number;
  soil?: number;
  light?: number;
};

type ReadingLike = {
  value: number | string;
  recorded_at?: string;
  recordedAt?: string;
  created_at?: string;
};

const metricConfig: Record<
  MetricKey,
  { label: string; unit: string; color: string }
> = {
  temp: { label: "Nhiệt độ", unit: "°C", color: "#ef4444" },
  humi: { label: "Độ ẩm không khí", unit: "%", color: "#0ea5e9" }, // consistent sky blue
  soil: { label: "Độ ẩm đất", unit: "%", color: "#10b981" }, // consistent green
  light: { label: "Ánh sáng", unit: "lux", color: "#f59e0b" }, // consistent amber
};

const limitOptions = [50, 100, 200, 300];
function normalizeText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getSensorMetric(sensor: Sensor): MetricKey | null {
  const haystack = `${normalizeText(sensor.type)} ${normalizeText(sensor.name)}`;

  if (haystack.includes("soil") || haystack.includes("dat")) {
    return "soil";
  }

  if (haystack.includes("light") || haystack.includes("lux")) {
    return "light";
  }

  if (haystack.includes("temp") || haystack.includes("nhiet")) {
    return "temp";
  }

  if (
    haystack.includes("humi") ||
    haystack.includes("humidity") ||
    haystack.includes("do am") ||
    haystack.includes("khong khi")
  ) {
    return "humi";
  }

  return null;
}

function formatTime(value: string, locale: string = "vi-VN") {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFullTime(value?: string, locale: string = "vi-VN") {
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

function toChartPoint(snapshot: TelemetrySnapshot, locale: string = "vi-VN", convertTemp?: (val: number) => number): ChartPoint {
  const tempVal = toNumber(snapshot.temp);
  return {
    recordedAt: snapshot.updatedAt,
    time: formatTime(snapshot.updatedAt, locale),
    temp: tempVal !== undefined && convertTemp ? Number(convertTemp(tempVal).toFixed(1)) : tempVal,
    humi: toNumber(snapshot.humi),
    soil: toNumber(snapshot.soil),
    light: toNumber(snapshot.light),
  };
}

function mergePoints(
  points: ChartPoint[],
  nextPoint: ChartPoint,
  limit: number,
) {
  const byTime = new Map(points.map((point) => [point.recordedAt, point]));
  byTime.set(nextPoint.recordedAt, {
    ...byTime.get(nextPoint.recordedAt),
    ...nextPoint,
  });

  return Array.from(byTime.values())
    .sort(
      (left, right) =>
        new Date(left.recordedAt).getTime() -
        new Date(right.recordedAt).getTime(),
    )
    .slice(-limit);
}

function buildHistoryPoints(
  readingsByMetric: Partial<Record<MetricKey, ReadingLike[]>>,
  locale: string = "vi-VN",
  convertTemp?: (val: number) => number
) {
  const byTime = new Map<string, ChartPoint>();

  Object.entries(readingsByMetric).forEach(([metric, readings]) => {
    readings?.forEach((reading) => {
      let value = toNumber(reading.value);

      if (value === undefined) {
        return;
      }
      if (metric === "temp" && convertTemp) {
        value = Number(convertTemp(value).toFixed(1));
      }

      const recordedAt = getReadingTime(reading);
      const current = byTime.get(recordedAt) ?? {
        recordedAt,
        time: formatTime(recordedAt, locale),
      };

      byTime.set(recordedAt, {
        ...current,
        [metric]: value,
      });
    });
  });

  return Array.from(byTime.values()).sort(
    (left, right) =>
      new Date(left.recordedAt).getTime() -
      new Date(right.recordedAt).getTime(),
  );
}

function getLatestValue(points: ChartPoint[], metric: MetricKey) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index][metric];

    if (typeof value === "number") {
      return value;
    }
  }

  return undefined;
}

interface TooltipEntry {
  dataKey: string;
  stroke?: string;
  value: number;
  name: string;
  payload: { recordedAt: string };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
}

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  const { language, t, tempUnit } = useLanguage();
  const locale = language === "vi" ? "vi-VN" : "en-US";
  if (active && payload && payload.length) {
    return (
      <div className="ch-tooltip">
        <div className="ch-tooltip-header">
          <Clock size={12} />
          <span>{formatFullTime(payload[0].payload.recordedAt, locale)}</span>
        </div>
        <div className="ch-tooltip-divider" />
        <div className="ch-tooltip-body">
          {payload.map((entry: TooltipEntry) => {
            const config = metricConfig[entry.dataKey as MetricKey];
            return (
              <div key={entry.dataKey} className="ch-tooltip-row">
                <span className="ch-tooltip-dot" style={{ backgroundColor: entry.stroke || config?.color }} />
                <span className="ch-tooltip-label">
                  {config ? t("history.metrics." + (entry.dataKey as MetricKey), config.label) : entry.name}:
                </span>
                <span className="ch-tooltip-val">
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

export function ChartView() {
  const { language, t, tempUnit, convertTemp } = useLanguage();
  const locale = language === "vi" ? "vi-VN" : "en-US";
  const [isMounted, setIsMounted] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [limit, setLimit] = useState(100);
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastRealtimeKeyRef = useRef<string | null>(null);
  const { telemetry, telemetryByMac, connected } = useRealtimeTelemetry();
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
        setSelectedDeviceId(
          (current) => current || nextDevices[0]?.Device_ID || "",
        );
      })
      .catch((err) => {
        if (mounted) {
          setError(
            err instanceof Error ? err.message : t("charts.failedDevices", "Không tải được thiết bị"),
          );
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.Device_ID === selectedDeviceId),
    [devices, selectedDeviceId],
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
        const entries = await Promise.all(
          (Object.entries(metricSensors) as [MetricKey, Sensor][]).map(
            async ([metric, sensor]) => {
              const readings = await getSensorReadings(sensor.Sensor_ID, limit);
              return [metric, readings] as const;
            },
          ),
        );

        if (!mounted) {
          return;
        }

        setPoints(
          buildHistoryPoints(Object.fromEntries(entries), locale, convertTemp).slice(-limit),
        );
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : t("charts.failedChart", "Không tải được dữ liệu biểu đồ"),
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
  }, [selectedDevice, metricSensors, limit]);

  useEffect(() => {
    if (!selectedDevice || !telemetry.updatedAt) {
      return;
    }

    if (
      telemetry.macAddress &&
      telemetry.macAddress !== selectedDevice.mac_address
    ) {
      return;
    }

    const realtimeKey = `${selectedDevice.Device_ID}-${telemetry.updatedAt}`;

    if (lastRealtimeKeyRef.current === realtimeKey) {
      return;
    }

    lastRealtimeKeyRef.current = realtimeKey;
    setPoints((current) =>
      mergePoints(current, toChartPoint(telemetry, locale, convertTemp), Math.max(limit, 100)),
    );
  }, [limit, selectedDevice, telemetry, locale]);

  const latestAt = points.at(-1)?.recordedAt;
  const latestValues = (Object.keys(metricConfig) as MetricKey[]).map(
    (metric) => ({
      ...metricConfig[metric],
      metric,
      value: getLatestValue(points, metric),
      unit: metric === "temp" ? `°${tempUnit}` : metricConfig[metric].unit,
    }),
  );

  const getSystemStatus = () => {
    const tempVal = getLatestValue(points, "temp");
    const humiVal = getLatestValue(points, "humi");
    const soilVal = getLatestValue(points, "soil");
    const lightVal = getLatestValue(points, "light");

    const deviceTelemetry = selectedDevice
      ? (telemetryByMac[selectedDevice.mac_address] ??
         (telemetry.macAddress === selectedDevice.mac_address ? telemetry : null))
      : null;

    const pumpOn = deviceTelemetry?.pumpState === true;
    const fanOn = deviceTelemetry?.fanState === true;
    const isAuto = deviceTelemetry?.autoMode !== false;

    if (tempVal === undefined) {
      return {
        code: "NORMAL",
        label: t("charts.status.normal", "Hệ thống bình thường"),
        desc: t("charts.status.normalDesc", "Đang chờ kết nối dữ liệu để phân tích môi trường..."),
        color: "#10b981",
        bg: "rgba(16, 185, 129, 0.05)",
        border: "rgba(16, 185, 129, 0.15)",
        ledColor: "Xanh lá (Green)"
      };
    }

    const isTempCritical = tempUnit === "F" ? tempVal > 95 : tempVal > 35;
    const isTempHighWarning = tempUnit === "F" ? tempVal > 86 : tempVal > 30;
    const isHumiLowWarning = humiVal !== undefined && humiVal < 40;
    const isSoilDryWarning = soilVal !== undefined && soilVal < 30;

    const hasMinorWarning = isTempHighWarning || isHumiLowWarning || isSoilDryWarning;
    const isLightLow = lightVal !== undefined && lightVal < 150;

    // 1. CRITICAL
    if (isTempCritical) {
      return {
        code: "CRITICAL",
        label: t("charts.status.critical", "CẢNH BÁO: Nhiệt độ cực cao!"),
        desc: t("charts.status.criticalDesc", "Nhiệt độ hiện tại đã vượt quá 35°C ({temp}). Đây là mức cực kỳ nguy hiểm cho sự phát triển của cây trồng. Vui lòng kích hoạt quạt thông gió và kiểm tra hệ thống che nắng ngay lập tức!").replace("{temp}", `${tempVal.toFixed(1)}°${tempUnit}`),
        color: "#ef4444",
        bg: "rgba(239, 68, 68, 0.05)",
        border: "rgba(239, 68, 68, 0.15)",
        ledColor: "Đỏ (Red)"
      };
    }

    // 2. Pump + Fan together
    if (pumpOn && fanOn) {
      return {
        code: "PUMP_FAN",
        label: t("charts.status.pumpFan", "Đang tưới nước & Làm mát tích cực"),
        desc: t("charts.status.pumpFanDesc", "Hệ thống đang đồng thời bật máy bơm nước để cân bằng độ ẩm đất và bật quạt thông gió để giải nhiệt cho nhà kính."),
        color: "#06b6d4",
        bg: "rgba(6, 182, 212, 0.05)",
        border: "rgba(6, 182, 212, 0.15)",
        ledColor: "Xanh ngọc (Cyan)"
      };
    }

    // 3. Only pump
    if (pumpOn) {
      return {
        code: "PUMPING",
        label: t("charts.status.pumping", "Đang trong chu kỳ tưới nước"),
        desc: t("charts.status.pumpingDesc", "Máy bơm nước đang hoạt động để cung cấp độ ẩm cần thiết cho đất. Hệ thống thông minh tự động giám sát độ bão hòa."),
        color: "#3b82f6",
        bg: "rgba(59, 130, 246, 0.05)",
        border: "rgba(59, 130, 246, 0.15)",
        ledColor: "Xanh dương (Blue)"
      };
    }

    // 4. Only fan manual
    if (fanOn && !isAuto) {
      return {
        code: "FAN_MANUAL",
        label: t("charts.status.fanManual", "Quạt làm mát bật thủ công"),
        desc: t("charts.status.fanManualDesc", "Quạt thông gió đang được vận hành thủ công bởi quản trị viên. Hệ thống tạm ngắt tự động hóa điều hòa nhiệt độ."),
        color: "#8b5cf6",
        bg: "rgba(139, 92, 246, 0.05)",
        border: "rgba(139, 92, 246, 0.15)",
        ledColor: "Tím (Purple)"
      };
    }

    // 5. Low light
    if (isLightLow) {
      return {
        code: "LOW_LIGHT",
        label: t("charts.status.lowLight", "Thiếu ánh sáng tự nhiên"),
        desc: t("charts.status.lowLightDesc", "Cường độ ánh sáng giảm xuống dưới ngưỡng tối thiểu ({light} lux). Grow light (đèn quang hợp) đã được tự động bật để bổ sung bức xạ quang hợp cho cây trồng.").replace("{light}", (lightVal || 0).toFixed(0)),
        color: "#6b7280",
        bg: "rgba(107, 114, 128, 0.05)",
        border: "rgba(107, 114, 128, 0.15)",
        ledColor: "Trắng / Grow Light (White)"
      };
    }

    // 6. Minor warning
    if (hasMinorWarning) {
      const warningReason: string[] = [];
      if (isTempHighWarning) warningReason.push(t("charts.status.warnTemp", "Nhiệt độ ấm lên ({temp})").replace("{temp}", `${tempVal.toFixed(1)}°${tempUnit}`));
      if (isHumiLowWarning && humiVal !== undefined) warningReason.push(t("charts.status.warnHumi", "Độ ẩm không khí thấp ({humi}%)").replace("{humi}", humiVal.toFixed(0)));
      if (isSoilDryWarning && soilVal !== undefined) warningReason.push(t("charts.status.warnSoil", "Đất đang khô dần ({soil}%)").replace("{soil}", soilVal.toFixed(0)));

      return {
        code: "WARNING",
        label: t("charts.status.warning", "Cảnh báo môi trường nhẹ"),
        desc: t("charts.status.warningDesc", "Phát hiện chỉ số môi trường chưa tối ưu: {reasons}. Hệ thống khuyên bạn nên điều chỉnh nhẹ để giữ cây trồng trong điều kiện tốt nhất.").replace("{reasons}", warningReason.join(", ")),
        color: "#f59e0b",
        bg: "rgba(245, 158, 11, 0.05)",
        border: "rgba(245, 158, 11, 0.15)",
        ledColor: "Vàng cam (Orange)"
      };
    }

    // 7. Normal
    return {
      code: "NORMAL",
      label: t("charts.status.normal", "Hệ sinh thái lý tưởng"),
      desc: t("charts.status.normalDesc", "Tất cả chỉ số môi trường (Nhiệt độ: {temp}, Độ ẩm khí: {humi}%, Độ ẩm đất: {soil}%, Ánh sáng: {light} lux) đang ở dải tối ưu tuyệt vời. Hệ thống LED báo trạng thái tốt.").replace("{temp}", `${tempVal.toFixed(1)}°${tempUnit}`).replace("{humi}", (humiVal || 0).toFixed(0)).replace("{soil}", (soilVal || 0).toFixed(0)).replace("{light}", (lightVal || 0).toFixed(0)),
      color: "#10b981",
      bg: "rgba(16, 185, 129, 0.05)",
      border: "rgba(16, 185, 129, 0.15)",
      ledColor: "Xanh lá (Green)"
    };
  };

  const status = getSystemStatus();

  return (
    <div className="ch-container">
      {/* Top Banner */}
      <section className="ch-header">
        <div className="ch-header-left">
          <span className="ch-badge-pill">
            {t("charts.telemetryRealtime", "Telemetry realtime")}
          </span>
          <h1 className="ch-title">
            {t("charts.title", "Biểu đồ cảm biến theo ESP")}
          </h1>
          <p className="ch-subtitle">
            {t("charts.subtitle", "Dữ liệu lịch sử lấy từ readings API, điểm mới được cập nhật từ socket realtime-data.")}
          </p>
        </div>

        <div className="ch-header-actions">
          <div className="ch-action-group">
            <span className="ch-action-label">{t("charts.espDevice", "Thiết bị ESP")}</span>
            <select
              value={selectedDeviceId}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              className="ch-select ch-select--esp"
            >
              {devices.map((device) => (
                <option key={device.Device_ID} value={device.Device_ID}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>

          <div className="ch-action-group">
            <span className="ch-action-label">{t("charts.dataPoints", "Số điểm dữ liệu")}</span>
            <select
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              className="ch-select"
            >
              {limitOptions.map((option) => (
                <option key={option} value={option}>
                  {option} {t("charts.pointsSuffix", "điểm")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Latest Values Cards */}
      <section className="ch-metric-grid">
        {latestValues.map(({ metric, label, unit, color, value }) => {
          const icon = metric === "temp" ? <Thermometer size={20} /> :
                       metric === "humi" ? <Wind size={20} /> :
                       metric === "soil" ? <Droplets size={20} /> :
                       <Waves size={20} />;
          return (
            <div
              key={metric}
              className={`ch-metric-card ch-metric-card--${metric}`}
            >
              <div className="ch-metric-left">
                <span className="ch-metric-label">{t("history.metrics." + metric, label)}</span>
                <div className="ch-metric-value-row">
                  <span className="ch-metric-val">{value ?? "--"}</span>
                  <span className="ch-metric-unit">{unit}</span>
                </div>
              </div>
              <div className={`ch-metric-icon-wrap ch-metric-icon-wrap--${metric}`}>
                {icon}
              </div>
            </div>
          );
        })}
      </section>

      {/* Charts & Details Panel */}
      <section className="ch-main-grid">
        {/* Main Chart Panel */}
        <div className="ch-panel">
          <div className="ch-panel-header">
            <div className="ch-panel-title-area">
              <h2 className="ch-panel-title">
                <Activity size={18} style={{ color: "#10b981" }} />
                {t("charts.sensorTrends", "Diễn biến cảm biến")}
              </h2>
              <p className="ch-panel-subtitle">
                {t("charts.lastUpdate", "Cập nhật gần nhất: {time}").replace("{time}", formatFullTime(latestAt, locale))}
              </p>
            </div>

            <div
              className={`ch-status-pill ${
                connected ? "ch-status-pill--online" : "ch-status-pill--offline"
              }`}
            >
              {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              {connected ? t("charts.realtimeOnline", "Realtime online") : t("charts.realtimeOffline", "Realtime offline")}
            </div>
          </div>

          {/* Tab Selector */}
          <div className="ch-tabs">
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={`ch-tab-btn ${
                activeTab === "all" ? "ch-tab-btn--all-active" : "ch-tab-btn--all"
              }`}
            >
              {t("charts.allSensors", "Tất cả cảm biến")}
            </button>
            {(Object.keys(metricConfig) as MetricKey[]).map((metric) => {
              const active = activeTab === metric;
              return (
                <button
                  key={metric}
                  type="button"
                  onClick={() => setActiveTab(metric)}
                  className={`ch-tab-btn ${
                    active ? "ch-tab-btn--metric-active text-white" : "ch-tab-btn--metric"
                  }`}
                  style={{
                    backgroundColor: active ? metricConfig[metric].color : undefined,
                  }}
                >
                  <span
                    className="ch-tab-dot"
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
          <div className="ch-chart-wrapper" style={{ marginTop: "0.5rem" }}>
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400 gap-2">
                <RefreshCcw size={16} className="animate-spin" />
                {t("charts.loadingChart", "Đang tải biểu đồ...")}
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
                {t("charts.initializingChart", "Đang khởi tạo biểu đồ...")}
              </div>
            ) : points.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Activity size={30} className="text-slate-300" />
                <p className="text-sm font-semibold text-slate-500">
                  {t("charts.noReadings", "Chưa có dữ liệu readings cho ESP này.")}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={points}
                  margin={{ left: 5, right: 10, top: 12, bottom: 8 }}
                >
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={true} horizontal={true} />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                    tickLine={{ stroke: "#cbd5e1" }}
                    axisLine={{ stroke: "#cbd5e1", strokeWidth: 1.5 }}
                    minTickGap={32}
                    dy={8}
                  />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    domain={
                      activeTab === "temp"
                        ? [0, 45]
                        : activeTab === "all" || activeTab === "humi" || activeTab === "soil"
                          ? [0, 100]
                          : ["auto", "auto"]
                    }
                    tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                    tickLine={{ stroke: "#cbd5e1" }}
                    axisLine={{ stroke: "#cbd5e1", strokeWidth: 1.5 }}
                    tickFormatter={(value) => {
                      if (activeTab === "temp") return `${value}°C`;
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
        </div>

        {/* Sidebar details */}
        <aside className="ch-sidebar">
          <div className="ch-side-card">
            <h3 className="ch-side-title">
              <Database size={16} style={{ display: "inline-block", marginRight: 6, verticalAlign: "middle", color: "#64748b" }} />
              {t("charts.dataSource", "Nguồn dữ liệu")}
            </h3>
            <div className="ch-info-list">
              <InfoRow label={t("charts.device", "Thiết bị")} value={selectedDevice?.name ?? "--"} />
              <InfoRow label={t("charts.macAddress", "Địa chỉ MAC")} value={selectedDevice?.mac_address ?? "--"} />
              <InfoRow label={t("charts.totalPoints", "Tổng số điểm")} value={`${points.length} ${t("charts.pointsSuffix", "điểm")}`} />
              <InfoRow label={t("charts.mappedSensors", "Cảm biến map")} value={`${Object.keys(metricSensors).length}/4`} />
            </div>
          </div>

          <div className="ch-side-card">
            <h3 className="ch-side-title">
              <Cpu size={16} style={{ display: "inline-block", marginRight: 6, verticalAlign: "middle", color: "#64748b" }} />
              {t("charts.physicalSensors", "Cảm biến vật lý")}
            </h3>
            <div className="ch-sensor-list">
              <SensorMapRow
                icon={<Thermometer size={16} />}
                label={t("history.metrics.temp", "Nhiệt độ")}
                sensor={metricSensors.temp}
                metric="temp"
              />
              <SensorMapRow
                icon={<Wind size={16} />}
                label={t("history.metrics.humi", "Độ ẩm không khí")}
                sensor={metricSensors.humi}
                metric="humi"
              />
              <SensorMapRow
                icon={<Droplets size={16} />}
                label={t("history.metrics.soil", "Độ ẩm đất")}
                sensor={metricSensors.soil}
                metric="soil"
              />
              <SensorMapRow
                icon={<Waves size={16} />}
                label={t("history.metrics.light", "Ánh sáng")}
                sensor={metricSensors.light}
                metric="light"
              />
            </div>
          </div>
        </aside>
      </section>

      {/* Real-time System Status Advisory Card */}
      <section 
        className="ch-status-card"
        style={{
          background: status.bg,
          borderColor: status.border,
        }}
      >
        <div className="ch-status-card-inner">
          <div className="ch-status-led-wrap">
            <span 
              className="ch-status-led-dot"
              style={{
                background: status.color,
                boxShadow: `0 0 12px ${status.color}, 0 0 4px ${status.color}`,
              }}
            />
            <span className="ch-status-led-pulse" style={{ background: status.color }} />
          </div>
          <div className="ch-status-content">
            <div className="ch-status-meta">
              <span className="ch-status-title">{status.label}</span>
              <span className="ch-status-led-text" style={{ color: status.color }}>
                {t("charts.status.ledState", "Chỉ báo LED:")} {status.ledColor}
              </span>
            </div>
            <p className="ch-status-desc">{status.desc}</p>
          </div>
        </div>
      </section>

      {/* Styled JSX block */}
      <style jsx global>{`
        .ch-container {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          font-family: inherit;
        }

        /* ===== Header / Welcome Banner ===== */
        .ch-header {
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
          .ch-header {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
          }
        }

        .ch-header-left {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .ch-badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.25rem 0.75rem;
          border-radius: 100px;
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border: 1px solid rgba(34, 197, 94, 0.15);
          background: rgba(34, 197, 94, 0.08);
          color: #16a34a;
          width: fit-content;
        }

        .ch-title {
          font-size: 1.875rem;
          font-weight: 850;
          color: #0f172a;
          letter-spacing: -0.02em;
          margin: 0;
        }

        .ch-subtitle {
          font-size: 0.875rem;
          color: #64748b;
          margin: 0;
        }

        .ch-header-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .ch-action-group {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .ch-action-label {
          font-size: 0.72rem;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .ch-select {
          padding: 0.65rem 2.25rem 0.65rem 1rem;
          border-radius: 12px;
          border: 1.5px solid #e2e8f0;
          background-color: #f8fafc;
          font-size: 0.875rem;
          font-weight: 700;
          outline: none;
          color: #334155;
          cursor: pointer;
          transition: all 0.2s;
          appearance: none;
          background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m6 8 4 4 4-4'/%3E%3C/svg%3E");
          background-position: right 0.75rem center;
          background-repeat: no-repeat;
          background-size: 1.1rem;
          box-shadow: 0 1px 2px rgba(0,0,0,0.02);
          min-width: 140px;
        }

        .ch-select--esp {
          min-width: 220px;
        }

        .ch-select:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 3.5px rgba(16, 185, 129, 0.12);
          background-color: white;
        }

        .ch-select:hover {
          border-color: #cbd5e1;
          background-color: #f1f5f9;
        }

        /* ===== Metrics Grid (Latest Values) ===== */
        .ch-metric-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        @media (min-width: 640px) {
          .ch-metric-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (min-width: 1280px) {
          .ch-metric-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }

        .ch-metric-card {
          background: white;
          border-radius: 24px;
          border: 1.5px solid #e2e8f0;
          padding: 1.25rem 1.5rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 12px rgba(0,0,0,0.01);
          position: relative;
          overflow: hidden;
        }

        .ch-metric-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 24px rgba(0,0,0,0.05);
        }

        .ch-metric-card--temp:hover { border-color: #fecaca; }
        .ch-metric-card--humi:hover { border-color: #7dd3fc; }
        .ch-metric-card--soil:hover { border-color: #86efac; }
        .ch-metric-card--light:hover { border-color: #fde047; }

        .ch-metric-card--temp:hover .ch-metric-val,
        .ch-metric-card--temp:hover .ch-metric-unit { color: #ef4444; }

        .ch-metric-card--humi:hover .ch-metric-val,
        .ch-metric-card--humi:hover .ch-metric-unit { color: #0ea5e9; }

        .ch-metric-card--soil:hover .ch-metric-val,
        .ch-metric-card--soil:hover .ch-metric-unit { color: #10b981; }

        .ch-metric-card--light:hover .ch-metric-val,
        .ch-metric-card--light:hover .ch-metric-unit { color: #f59e0b; }

        .ch-metric-left {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          min-width: 0;
          flex: 1;
        }

        .ch-metric-label {
          font-size: 0.75rem;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .ch-metric-value-row {
          display: flex;
          align-items: flex-end;
          gap: 0.25rem;
          margin-top: 0.25rem;
        }

        .ch-metric-val {
          font-size: 1.875rem;
          font-weight: 900;
          color: #0f172a;
          line-height: 1;
          transition: color 0.25s ease;
        }

        .ch-metric-unit {
          font-size: 1.1rem;
          font-weight: 750;
          color: #64748b;
          align-self: flex-end;
          padding-bottom: 2px;
          transition: color 0.25s ease;
        }

        .ch-metric-icon-wrap {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: transform 0.3s;
        }

        .ch-metric-card:hover .ch-metric-icon-wrap {
          transform: scale(1.08) rotate(3deg);
        }

        .ch-metric-icon-wrap--temp { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
        .ch-metric-icon-wrap--humi { background: rgba(14, 165, 233, 0.12); color: #0ea5e9; }
        .ch-metric-icon-wrap--soil { background: rgba(16, 185, 129, 0.12); color: #10b981; }
        .ch-metric-icon-wrap--light { background: rgba(245, 158, 11, 0.12); color: #f59e0b; }

        /* ===== Main Grid ===== */
        .ch-main-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }

        @media (min-width: 1280px) {
          .ch-main-grid {
            grid-template-columns: 1fr 320px;
          }
        }

        .ch-panel {
          background: white;
          border-radius: 28px;
          border: 1.5px solid #e2e8f0;
          padding: 1.75rem;
          box-shadow: 0 4px 20px rgba(0,0,0,0.02);
          display: flex;
          flex-direction: column;
        }

        .ch-chart-wrapper {
          flex: 1;
          min-height: 430px;
          min-width: 0;
        }

        .ch-panel-header {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }

        @media (min-width: 640px) {
          .ch-panel-header {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
          }
        }

        .ch-panel-title-area {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .ch-panel-title {
          font-size: 1.25rem;
          font-weight: 850;
          color: #0f172a;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .ch-panel-subtitle {
          font-size: 0.85rem;
          color: #64748b;
          margin: 0;
        }

        .ch-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.35rem 0.85rem;
          border-radius: 100px;
          font-size: 0.75rem;
          font-weight: 700;
          border: 1px solid transparent;
          width: fit-content;
        }

        .ch-status-pill--online {
          background: rgba(34, 197, 94, 0.08);
          color: #16a34a;
          border-color: rgba(34, 197, 94, 0.15);
        }

        .ch-status-pill--offline {
          background: #f1f5f9;
          color: #64748b;
          border-color: #e2e8f0;
        }

        /* Tab Selectors */
        .ch-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          border-bottom: 1.5px solid #f1f5f9;
          padding-bottom: 1.25rem;
          margin-bottom: 1.5rem;
        }

        .ch-tab-btn {
          border: none;
          padding: 0.6rem 1.1rem;
          border-radius: 12px;
          font-size: 0.78rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          gap: 0.45rem;
        }

        .ch-tab-btn--all {
          background: #f8fafc;
          color: #475569;
          border: 1.5px solid #e2e8f0;
        }

        .ch-tab-btn--all:hover {
          background: #f1f5f9;
          border-color: #cbd5e1;
        }

        .ch-tab-btn--all-active {
          background: #0f172a;
          color: white;
          border: 1.5px solid #0f172a;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
        }

        .ch-tab-btn--metric {
          background: #f8fafc;
          color: #475569;
          border: 1.5px solid #e2e8f0;
        }

        .ch-tab-btn--metric:hover {
          background: #f1f5f9;
          border-color: #cbd5e1;
        }

        .ch-tab-btn--metric-active {
          color: white;
          border-color: transparent;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        .ch-tab-dot {
          width: 7.5px;
          height: 7.5px;
          border-radius: 50%;
        }

        /* ===== Recharts Tooltip Custom styling ===== */
        .ch-tooltip {
          background: rgba(255, 255, 255, 0.96);
          border: 1.5px solid #e2e8f0;
          border-radius: 16px;
          padding: 0.9rem 1rem;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(8px);
          font-family: inherit;
        }

        .ch-tooltip-header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.72rem;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .ch-tooltip-divider {
          height: 1.5px;
          background: #f1f5f9;
          margin: 0.5rem 0;
        }

        .ch-tooltip-body {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }

        .ch-tooltip-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.82rem;
        }

        .ch-tooltip-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .ch-tooltip-label {
          color: #475569;
          font-weight: 600;
        }

        .ch-tooltip-val {
          color: #0f172a;
          font-weight: 800;
          margin-left: auto;
        }

        /* ===== Sidebar (Aside) Panels ===== */
        .ch-sidebar {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .ch-side-card {
          background: white;
          border-radius: 24px;
          border: 1.5px solid #e2e8f0;
          padding: 1.5rem;
          box-shadow: 0 4px 20px rgba(0,0,0,0.02);
        }

        .ch-side-title {
          font-size: 1rem;
          font-weight: 850;
          color: #0f172a;
          margin: 0 0 1.25rem 0;
          display: flex;
          align-items: center;
        }

        .ch-info-list {
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
        }

        .ch-info-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.75rem 1rem;
          background: #f8fafc;
          border: 1.5px solid #f1f5f9;
          border-radius: 14px;
          font-size: 0.8rem;
          font-weight: 650;
          min-width: 0;
        }

        .ch-info-label {
          color: #64748b;
        }

        .ch-info-value {
          color: #334155;
          font-weight: 750;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }

        .ch-sensor-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .ch-sensor-row {
          display: flex;
          align-items: center;
          gap: 0.875rem;
          padding: 0.875rem 1rem;
          background: #f8fafc;
          border: 1.5px solid #f1f5f9;
          border-radius: 18px;
          transition: all 0.2s ease;
        }

        .ch-sensor-row:hover {
          background: white;
          border-color: #cbd5e1;
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
          transform: translateX(1.5px);
        }

        .ch-sensor-icon-box {
          width: 36px;
          height: 36px;
          border-radius: 11px;
          background: white;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #10b981;
          flex-shrink: 0;
          border: 1px solid #f1f5f9;
          box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }

        .ch-sensor-details {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          min-width: 0;
        }

        .ch-sensor-name-lbl {
          font-size: 0.85rem;
          font-weight: 800;
          color: #0f172a;
        }

        .ch-sensor-meta-lbl {
          font-size: 0.72rem;
          color: #64748b;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* ===== Smart Status Card ===== */
        .ch-status-card {
          border-radius: 24px;
          border: 1.5px solid #e2e8f0;
          padding: 1.5rem;
          background: white;
          box-shadow: 0 4px 16px rgba(0,0,0,0.01);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .ch-status-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.03);
        }

        .ch-status-card-inner {
          display: flex;
          align-items: flex-start;
          gap: 1.25rem;
        }

        .ch-status-led-wrap {
          position: relative;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 0.2rem;
        }

        .ch-status-led-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          z-index: 2;
        }

        .ch-status-led-pulse {
          position: absolute;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          opacity: 0.25;
          animation: chLedPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          z-index: 1;
        }

        @keyframes chLedPulse {
          0%, 100% {
            transform: scale(0.7);
            opacity: 0.1;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.35;
          }
        }

        .ch-status-content {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          flex: 1;
          min-width: 0;
        }

        .ch-status-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }

        .ch-status-title {
          font-size: 1.05rem;
          font-weight: 850;
          color: #0f172a;
          letter-spacing: -0.01em;
        }

        .ch-status-led-text {
          font-size: 0.72rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          background: rgba(0,0,0,0.02);
          padding: 0.2rem 0.6rem;
          border-radius: 6px;
        }


        .ch-status-desc {
          font-size: 0.85rem;
          color: #475569;
          line-height: 1.5;
          margin: 0;
          font-weight: 500;
        }

        /* ===== Export Report Card ===== */
        .export-card {
          background: white;
          border-radius: 16px;
          border: 1.5px solid #e2e8f0;
          overflow: hidden;
          box-shadow: 0 2px 12px rgba(0,0,0,0.04);
          transition: box-shadow 0.2s ease;
        }

        .export-card:hover {
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }

        .export-card__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem 1.25rem;
          cursor: pointer;
          user-select: none;
        }

        .export-card__header-left {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .export-card__icon-wrap {
          width: 36px;
          height: 36px;
          background: linear-gradient(135deg, #1a7f4b, #22c55e);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
        }

        .export-card__title {
          font-size: 0.9rem;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }

        .export-card__subtitle {
          font-size: 0.73rem;
          color: #94a3b8;
          margin: 0;
          font-weight: 500;
        }

        .export-card__toggle-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: #94a3b8;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          transition: background 0.15s;
        }

        .export-card__toggle-btn:hover {
          background: #f1f5f9;
          color: #475569;
        }

        .export-card__body {
          padding: 0 1.25rem 1.25rem;
          border-top: 1px solid #f1f5f9;
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
        }

        .export-card__presets {
          display: flex;
          gap: 0.4rem;
          flex-wrap: wrap;
          padding-top: 0.85rem;
        }

        .export-card__preset-btn {
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 3px 10px;
          font-size: 0.72rem;
          font-weight: 600;
          color: #475569;
          cursor: pointer;
          transition: all 0.15s;
        }

        .export-card__preset-btn:hover {
          background: #dcfce7;
          border-color: #86efac;
          color: #15803d;
        }

        .export-card__date-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .export-card__date-group {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }

        .export-card__date-label {
          font-size: 0.7rem;
          font-weight: 600;
          color: #94a3b8;
          display: flex;
          align-items: center;
          gap: 3px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .export-card__date-input {
          border: 1.5px solid #e2e8f0;
          border-radius: 8px;
          padding: 6px 8px;
          font-size: 0.78rem;
          font-weight: 600;
          color: #0f172a;
          background: #f8fafc;
          width: 100%;
          outline: none;
          transition: border-color 0.15s;
        }

        .export-card__date-input:focus {
          border-color: #22c55e;
          background: white;
        }

        .export-card__date-sep {
          color: #94a3b8;
          font-weight: 700;
          font-size: 1rem;
          margin-top: 16px;
        }

        .export-card__error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 0.78rem;
          color: #dc2626;
          font-weight: 500;
        }

        .export-card__actions {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .export-card__btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 9px 14px;
          border-radius: 10px;
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
          border: none;
          transition: all 0.18s ease;
          letter-spacing: 0.01em;
        }

        .export-card__btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .export-card__btn--excel {
          background: linear-gradient(135deg, #16a34a, #22c55e);
          color: white;
          box-shadow: 0 2px 8px rgba(22, 163, 74, 0.3);
        }

        .export-card__btn--excel:hover:not(:disabled) {
          background: linear-gradient(135deg, #15803d, #16a34a);
          box-shadow: 0 4px 14px rgba(22, 163, 74, 0.4);
          transform: translateY(-1px);
        }

        .export-card__btn--pdf {
          background: linear-gradient(135deg, #dc2626, #ef4444);
          color: white;
          box-shadow: 0 2px 8px rgba(220, 38, 38, 0.3);
        }

        .export-card__btn--pdf:hover:not(:disabled) {
          background: linear-gradient(135deg, #b91c1c, #dc2626);
          box-shadow: 0 4px 14px rgba(220, 38, 38, 0.4);
          transform: translateY(-1px);
        }

        .export-card__note {
          font-size: 0.7rem;
          color: #94a3b8;
          line-height: 1.5;
          margin: 0;
          font-weight: 500;
        }
      `}</style>

    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ch-info-row">
      <span className="ch-info-label">{label}</span>
      <span className="ch-info-value" title={value}>
        {value}
      </span>
    </div>
  );
}

function SensorMapRow({
  icon,
  label,
  sensor,
  metric,
}: {
  icon: React.ReactNode;
  label: string;
  sensor?: Sensor;
  metric: MetricKey;
}) {
  const { t } = useLanguage();
  return (
    <div className="ch-sensor-row">
      <div className={`ch-sensor-icon-box ch-metric-icon-wrap--${metric}`}>
        {icon}
      </div>
      <div className="ch-sensor-details">
        <p className="ch-sensor-name-lbl">{label}</p>
        <p className="ch-sensor-meta-lbl" title={sensor ? `${sensor.name} (Pin ${sensor.pin_connection})` : t("charts.sensorStatus.notConfigured", "Chưa map được sensor")}>
          {sensor
            ? `${sensor.name} · Pin ${sensor.pin_connection}`
            : t("charts.sensorStatus.notConfigured", "Chưa map được sensor")}
        </p>
      </div>
    </div>
  );
}
