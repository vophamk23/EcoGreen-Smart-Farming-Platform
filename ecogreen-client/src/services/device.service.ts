import { fetcher } from "./api";
import {
  Device,
  CreateDevicePayload,
} from "@/types";

type DeviceResponse = Device | { data: Device };

export interface SensorReading {
  Reading_ID?: string | number;
  Sensor_ID?: string;
  value: number | string;
  recorded_at?: string;
  recordedAt?: string;
  created_at?: string;
}

function unwrapDevice(response: DeviceResponse): Device {
  const device = "data" in response ? response.data : response;

  return {
    ...device,
    status: device.status ?? "offline",
    last_seen_at: device.last_seen_at ?? null,
    sensors: device.sensors ?? [],
    actuators: device.actuators ?? [],
  };
}

// Lấy danh sách tất cả thiết bị của user
export const getDevices = (): Promise<Device[]> => {
  return fetcher<DeviceResponse[]>("/v1/devices", { cache: "no-store" }).then((devices) =>
    devices.map(unwrapDevice)
  );
};

// Lấy danh sách địa chỉ MAC được phát hiện chưa đăng ký
export const getDiscoveredDevices = (): Promise<string[]> => {
  return fetcher<string[]>("/v1/devices/discovery", { cache: "no-store" });
};

// Tạo thiết bị mới
export const createDevice = (payload: CreateDevicePayload): Promise<Device> => {
  return fetcher<DeviceResponse>("/v1/devices", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(unwrapDevice);
};

// Xóa thiết bị
export const deleteDevice = (deviceId: string): Promise<void> => {
  return fetcher(`/v1/devices/${deviceId}`, {
    method: "DELETE",
  });
};

export const toggleActuator = (
  actuatorId: string,
  state: boolean
): Promise<unknown> => {
  return fetcher(`/v1/actuators/${actuatorId}/toggle`, {
    method: "POST",
    body: JSON.stringify({ state }),
  });
};

export const getSensorReadings = (
  sensorId: string,
  limit = 100,
  startDate?: string,
  endDate?: string
): Promise<SensorReading[]> => {
  let url = `/v1/sensors/${sensorId}/readings?limit=${limit}`;
  if (startDate) url += `&startDate=${startDate}`;
  if (endDate) url += `&endDate=${endDate}`;
  return fetcher<SensorReading[]>(url);
};

export const setDeviceMode = (
  deviceId: string,
  autoMode: boolean
): Promise<unknown> => {
  return fetcher(`/v1/devices/${deviceId}/mode`, {
    method: "POST",
    body: JSON.stringify({ autoMode }),
  });
};
