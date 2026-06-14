import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SensorsService } from './sensors.service';
import { AuthGuard } from '../auth/auth.guard';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Sensors')
@UseGuards(AuthGuard)
@Controller('/v1')
export class SensorsController {
  constructor(private readonly sensorsService: SensorsService) {}

  @ApiOperation({ summary: 'Get all sensors of a device' })
  @Get('devices/:deviceId/sensors')
  async getSensors(@Param('deviceId') deviceId: string) {
    const sensors = await this.sensorsService.getSensorsByDevice(deviceId);

    return {
      message: 'Lấy danh sách cảm biến thành công',
      data: sensors,
    };
  }

  @ApiOperation({ summary: 'Get sensor data history' })
  @Get('sensors/:sensorId/readings')
  async getReadings(
    @Param('sensorId') sensorId: string,
    @Query('limit') limit: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const readings = await this.sensorsService.getSensorReadings(
      sensorId,
      limit ? parseInt(limit) : 50,
      startDate,
      endDate,
    );

    return {
      message: 'Lấy lịch sử dữ liệu cảm biến thành công',
      data: readings,
    };
  }
}
