import { OmitType } from '@nestjs/swagger';
import { MeDto } from './me.dto';

/** What other users may see of a profile: Me without the private fields. */
export class UserCardDto extends OmitType(MeDto, [
  'email',
  'timezone',
  'credits',
  'onboarded',
  'isPublic',
  'availability',
] as const) {}
