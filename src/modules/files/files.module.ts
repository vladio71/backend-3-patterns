import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig, CONFIG } from '../../common/config';
import { ProductsModule } from '../products/products.module';
import { FakeObjectStorage } from './fake-object-storage';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { OBJECT_STORAGE, ObjectStorage } from './object-storage';
import { ProductImage } from './product-image.entity';
import { S3ObjectStorage } from './s3-object-storage';

@Module({
  imports: [TypeOrmModule.forFeature([ProductImage]), ProductsModule],
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: OBJECT_STORAGE,
      inject: [CONFIG],
      useFactory: (config: AppConfig): ObjectStorage =>
        config.storage.driver === 'fake' ? new FakeObjectStorage(config.storage.presignExpiresSec) : new S3ObjectStorage(config.storage),
    },
  ],
  exports: [FilesService, OBJECT_STORAGE],
})
export class FilesModule {}
