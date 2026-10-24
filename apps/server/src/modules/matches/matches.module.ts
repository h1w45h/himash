import { Module } from '@nestjs/common';
import { MatchRuntime } from './match-runtime.service';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';

@Module({
  controllers: [MatchesController],
  providers: [MatchesService, MatchRuntime],
  exports: [MatchesService, MatchRuntime],
})
export class MatchesModule {}
