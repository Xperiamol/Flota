/**
 * 预下载 Mem0 嵌入模型
 * 在打包前运行，将模型下载到 models/ 目录，随应用一起打包
 */

async function preDownloadModels() {
    console.log('='.repeat(60));
    console.log('预下载 Mem0 嵌入模型');
    console.log('='.repeat(60));

    try {
        const path = require('path');
        const fs = require('fs');

        // 2. 设置缓存目录到项目根目录的 models/
        const projectRoot = path.join(__dirname, '..');
        const modelsPath = path.join(projectRoot, 'models');

        if (!fs.existsSync(modelsPath)) {
            fs.mkdirSync(modelsPath, { recursive: true });
        }

        console.log(`✓ 模型目录: ${modelsPath}`);

        // 3. 检查模型是否已存在
        const modelPath = path.join(modelsPath, 'Xenova', 'all-MiniLM-L6-v2');
        if (['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'].every(file => {
            const target = path.join(modelPath, file);
            return fs.existsSync(target) && fs.statSync(target).size > 0;
        })) {
            console.log('\n✓ 模型已存在，跳过下载');
            console.log(`  位置: ${modelPath}`);

            // 显示文件信息
            const files = fs.readdirSync(modelPath, { recursive: true, withFileTypes: true });
            let totalSize = 0;

            files.forEach(file => {
                if (file.isFile()) {
                    const filePath = path.join(file.parentPath || file.path, file.name);
                    const stats = fs.statSync(filePath);
                    totalSize += stats.size;
                }
            });

            console.log(`  总大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
            console.log('\n' + '='.repeat(60));
            console.log('✓ 模型准备就绪');
            console.log('='.repeat(60) + '\n');
            return;
        }

        const { pipeline, env } = await import('@xenova/transformers');
        env.cacheDir = modelsPath;
        env.allowRemoteModels = true;
        env.allowLocalModels = true;

        // 4. 下载模型
        console.log('\n[2/4] 下载模型 Xenova/all-MiniLM-L6-v2...');
        console.log('      模型大小约 22MB，请稍候...\n');

        const embedder = await pipeline(
            'feature-extraction',
            'Xenova/all-MiniLM-L6-v2',
            {
                quantized: true,  // 使用量化模型
                progress_callback: (progress) => {
                    if (progress.status === 'progress') {
                        const percent = ((progress.loaded / progress.total) * 100).toFixed(1);
                        const loaded = (progress.loaded / 1024 / 1024).toFixed(2);
                        const total = (progress.total / 1024 / 1024).toFixed(2);
                        process.stdout.write(`\r      进度: ${percent}% (${loaded}/${total} MB)`);
                    } else if (progress.status === 'done') {
                        console.log(`\r      ✓ ${progress.file} 下载完成                    `);
                    }
                }
            }
        );

        console.log('\n✓ 模型下载完成！');

        // 5. 测试模型
        console.log('\n[3/4] 测试模型...');
        const testText = '这是一个测试文本';
        const output = await embedder(testText, {
            pooling: 'mean',
            normalize: true
        });

        const vector = Array.from(output.data);
        console.log(`✓ 测试成功！向量维度: ${vector.length}`);

        // 6. 显示文件信息
        console.log('\n[4/4] 模型文件信息:');
        if (fs.existsSync(modelPath)) {
            const files = fs.readdirSync(modelPath, { recursive: true, withFileTypes: true });
            let totalSize = 0;

            files.forEach(file => {
                if (file.isFile()) {
                    const filePath = path.join(file.parentPath || file.path, file.name);
                    const stats = fs.statSync(filePath);
                    totalSize += stats.size;
                    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
                    const relativePath = path.relative(modelPath, filePath);
                    console.log(`  ${relativePath.padEnd(30)} ${sizeMB.padStart(8)} MB`);
                }
            });

            console.log(`  ${'总计'.padEnd(30)} ${(totalSize / 1024 / 1024).toFixed(2).padStart(8)} MB`);
        }

        console.log('\n' + '='.repeat(60));
        console.log('✓ 预下载完成！模型已准备好打包');
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('\n✗ 预下载失败:', error.message);
        console.error('\n可能的原因:');
        console.error('1. 网络连接问题');
        console.error('2. HuggingFace 无法访问（可能需要代理）');
        console.error('3. 磁盘空间不足');
        console.error('4. @xenova/transformers 未正确安装\n');
        process.exit(1);
    }
}

preDownloadModels();
