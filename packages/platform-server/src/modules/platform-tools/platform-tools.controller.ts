/** 公共宿主的五个原工具接口。原Rental Controller按装配选择窄委托同一服务。 */
import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { GeneratePlatformNumberDto, SavePlatformDictionaryBodyInputDto, SavePlatformNumberRuleBodyInputDto } from "./platform-tools.dto";
import { PlatformToolsService } from "./platform-tools.service";

@Controller("platform")
export class PlatformToolsController {
  constructor(private readonly tools: PlatformToolsService) {}

  @Get("dictionaries")
  dictionaries() { return this.tools.listDictionaries(); }

  @Put("dictionaries/:code")
  saveDictionary(@Param("code") code: string, @Body() body: SavePlatformDictionaryBodyInputDto) {
    return this.tools.saveDictionaryGroup({ ...body, code });
  }

  @Get("number-rules")
  numberRules() { return this.tools.listNumberRules(); }

  @Put("number-rules/:code")
  saveNumberRule(@Param("code") code: string, @Body() body: SavePlatformNumberRuleBodyInputDto) {
    return this.tools.saveNumberRule({ ...body, code });
  }

  @Post("number-rules/generate")
  generateNumber(@Body() body: GeneratePlatformNumberDto) { return this.tools.generateNumber(body); }
}
