import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

export const loadSwagger = (
  app: INestApplication,
  schemas: OpenAPIObject['components']['schemas'] = {}
) => {
  const config = new DocumentBuilder()
    .setTitle('Postiz Swagger file')
    .setDescription('API description')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, {
    ...config,
    components: { ...config.components, schemas },
  });
  SwaggerModule.setup('docs', app, document);
};
