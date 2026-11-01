import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Socket payloads are validated by hand in the gateway (no HTTP ValidationPipe there). */
export class MatchRefDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  matchId!: string;
}

export class ChatSendDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  matchId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 2000)
  body!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  clientId!: string;
}

export class ChatTypingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  matchId!: string;

  @IsBoolean()
  typing!: boolean;
}

export class ChatReadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  matchId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  lastMessageId!: string;
}
