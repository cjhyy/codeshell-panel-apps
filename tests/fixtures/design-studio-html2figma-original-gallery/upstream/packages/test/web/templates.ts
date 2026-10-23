// Predefined HTML templates for demo purposes

import { rubyJewelryHTML } from './templates/ruby-jewelry';

export interface Template {
    name: string;
    description: string;
    html: string;
    category: 'basic' | 'layout' | 'components' | 'advanced';
}

export const templates: Template[] = [
    {
        name: '[Advanced] Ruby Jewelry Landing Page',
        description: 'Full landing page with hero, gradients, z-index layers, and Tailwind CSS',
        category: 'advanced',
        html: rubyJewelryHTML,
    },
    {
        name: '[Advanced] Gradient Text with background-clip',
        description: 'Test gradient text with background-clip: text property',
        category: 'advanced',
        html: `<div style="width: 1000px; padding: 40px; background: #f5f5f5; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 20px 0; color: #333; font-size: 32px;">Background Clip: Text - 渐变文字测试</h1>
        <p style="margin: 0 0 30px 0; color: #666;">测试 background-clip: text 的渐变文字效果</p>

        <!-- 测试用例 1: 纯渐变文字 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 1: 纯渐变文字（inline-block）</h3>
            <div style="text-align: center;">
                <div style="
                    font-size: 48px;
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                    display: inline-block;
                    padding: 10px;
                ">GRADIENT ONLY</div>
            </div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期：文字有渐变填充，外层 div 无背景</p>
        </div>

        <!-- 测试用例 2: 混合文本（渐变 + 普通） -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 2: 混合文本（inline 元素）</h3>
            <p style="font-size: 24px; color: #333;">
                这是普通文本 
                <span style="
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                ">这是渐变文本</span> 
                这又是普通文本
            </p>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期：只有 span 内的文字有渐变，其他文字是普通黑色</p>
        </div>

        <!-- 测试用例 3: 大标题场景 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 3: 大标题场景（72px）</h3>
            <div style="
                font-size: 72px;
                font-weight: bold;
                text-align: center;
                line-height: 1;
                color: #333;
            ">
                The Intelligence That Can 
                <span style="
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                ">Discover</span>
            </div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期："Discover" 有渐变，其他文字是黑色</p>
        </div>

        <!-- 测试用例 4: 多个不同渐变 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 4: 多个不同渐变混合</h3>
            <p style="font-size: 32px; color: #333;">
                普通文本 
                <span style="
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                ">青色渐变</span> 
                中间文本 
                <span style="
                    background: linear-gradient(45deg, #ff6b6b, #ee5a6f);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                ">红色渐变</span> 
                结尾
            </p>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期：两个 span 各自有不同的渐变，其他是黑色</p>
        </div>

        <!-- 测试用例 5: 径向渐变 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 5: 径向渐变文本</h3>
            <div style="font-size: 40px; text-align: center;">
                普通文本前 
                <span style="
                    background: radial-gradient(circle, #f093fb, #f5576c);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                ">RADIAL</span> 
                普通文本后
            </div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期："RADIAL" 有径向渐变</p>
        </div>

        <!-- 测试用例 6: 对比 - 没有 background-clip: text -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 6: 对比 - 没有 background-clip: text</h3>
            <div style="
                font-size: 48px;
                background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                font-weight: bold;
                display: inline-block;
                padding: 10px;
                color: #333;
            ">NO CLIP TEXT</div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期：外层 div 有渐变背景，文字是黑色</p>
        </div>

        <!-- 预期结果说明 -->
        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196f3; margin-top: 30px;">
            <h3 style="margin: 0 0 10px 0; color: #1976d2;">✅ 预期转换结果</h3>
            <ul style="margin: 0; padding-left: 20px; color: #1565c0; line-height: 1.8;">
                <li><strong>有 background-clip: text</strong>：渐变直接应用到文字的 fills，外层无背景</li>
                <li><strong>没有 background-clip: text</strong>：外层有渐变背景，文字使用 color 属性</li>
                <li><strong>普通文本</strong>：使用 color 属性的颜色，纯色 SOLID fill</li>
                <li><strong>混合场景</strong>：每个文本节点独立处理，不相互影响</li>
            </ul>
        </div>
    </div>`
    },
    {
        name: '[Advanced] SVG Vector Test',
        description: 'Test SVG elements conversion to Figma Vector nodes',
        category: 'advanced',
        html: `<div style="width: 800px; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
            <h1 style="margin: 0 0 20px 0; color: #333;">SVG to Vector Conversion Test</h1>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h2 style="margin: 0 0 15px 0; color: #333;">Basic Shapes</h2>
                <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
                    <svg width="100" height="60" viewBox="0 0 100 60">
                        <rect x="10" y="10" width="80" height="40" fill="#ff6b6b" stroke="#333" stroke-width="2"/>
                    </svg>
                    <svg width="80" height="80" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="30" fill="#4ecdc4" stroke="#333" stroke-width="2"/>
                    </svg>
                    <svg width="100" height="60" viewBox="0 0 100 60">
                        <line x1="10" y1="30" x2="90" y2="30" stroke="#45b7d1" stroke-width="3"/>
                    </svg>
                </div>
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h2 style="margin: 0 0 15px 0; color: #333;">Path Elements</h2>
                <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
                    <svg width="100" height="80" viewBox="0 0 100 80">
                        <path d="M 10 40 L 50 10 L 90 40 L 50 70 Z" fill="#f7b731" stroke="#333" stroke-width="2"/>
                    </svg>
                    <svg width="120" height="80" viewBox="0 0 120 80">
                        <path d="M 10 40 C 10 10, 50 10, 60 40 C 70 70, 110 70, 110 40" fill="none" stroke="#5f27cd" stroke-width="3"/>
                    </svg>
                </div>
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h2 style="margin: 0 0 15px 0; color: #333;">Complex SVG</h2>
                <div style="display: flex; gap: 20px; align-items: center;">
                    <svg width="150" height="120" viewBox="0 0 150 120">
                        <rect x="20" y="20" width="110" height="80" fill="#ff9ff3" stroke="#333" stroke-width="2" rx="10"/>
                        <circle cx="75" cy="60" r="25" fill="#54a0ff"/>
                        <path d="M 60 45 L 75 30 L 90 45 L 90 75 L 60 75 Z" fill="#feca57"/>
                        <line x1="30" y1="30" x2="120" y2="90" stroke="#ff6348" stroke-width="2"/>
                    </svg>
                </div>
            </div>
        </div>`
    },
    {
        name: '[Advanced] Fixed Position Test Enhanced',
        description: 'Enhanced test for position: fixed elements - demonstrates how fixed elements are hoisted to root level',
        category: 'advanced',
        html: `<div style="width: 800px; height: 600px; background: #f0f0f0; position: relative; font-family: Arial, sans-serif;">
            <h1 style="margin: 0 0 20px 0; padding: 20px;">Fixed Position Test Enhanced</h1>
            <p style="margin: 0 0 20px 0; padding: 0 20px;">This is regular content in the document flow.</p>
            
            <!-- Fixed header -->
            <div style="position: fixed; top: 0; left: 0; right: 0; height: 60px; background: #333; color: white; display: flex; align-items: center; justify-content: center; z-index: 100;">
                Fixed Header (top: 0, z-index: 100)
            </div>
            
            <!-- Fixed sidebar -->
            <div style="position: fixed; top: 60px; left: 0; width: 200px; height: calc(100vh - 60px); background: #666; color: white; padding: 20px; z-index: 90;">
                <h3 style="margin: 0 0 15px 0;">Fixed Sidebar</h3>
                <ul style="margin: 0; padding: 0; list-style: none;">
                    <li style="margin-bottom: 10px; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">Menu Item 1</li>
                    <li style="margin-bottom: 10px; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">Menu Item 2</li>
                    <li style="margin-bottom: 10px; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">Menu Item 3</li>
                </ul>
            </div>
            
            <!-- Main content -->
            <div style="margin-left: 220px; margin-top: 80px; padding: 20px;">
                <h2 style="margin: 0 0 15px 0;">Main Content</h2>
                <p style="margin: 0 0 15px 0;">This content should be positioned normally, while the fixed elements should be at the top level.</p>
                <div style="height: 400px; background: #e0e0e0; border: 1px solid #ccc; padding: 20px; border-radius: 8px;">
                    <p style="margin: 0 0 15px 0;">Regular content block</p>
                    <p style="margin: 0;">The fixed elements should be hoisted to the root Frame's children, maintaining their visual positioning but appearing at the top level of the hierarchy.</p>
                </div>
            </div>
            
            <!-- Fixed footer -->
            <div style="position: fixed; bottom: 0; left: 0; right: 0; height: 50px; background: #444; color: white; display: flex; align-items: center; justify-content: center; z-index: 95;">
                Fixed Footer (bottom: 0, z-index: 95)
            </div>
            
            <!-- Fixed floating button with highest z-index -->
            <div style="position: fixed; bottom: 70px; right: 20px; width: 60px; height: 60px; background: #007bff; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; z-index: 110; font-size: 24px; font-weight: bold; cursor: pointer;">
                +
            </div>
            
            <!-- Fixed modal overlay -->
            <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 200; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); max-width: 400px;">
                    <h3 style="margin: 0 0 15px 0; color: #333;">Fixed Modal</h3>
                    <p style="margin: 0 0 20px 0; color: #666;">This modal should appear on top of all other fixed elements (z-index: 200)</p>
                    <button style="background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">Close</button>
                </div>
            </div>
        </div>`
    },
    {
        name: '[Advanced] Z-Index Sorting Test',
        description: 'Test z-index based sorting of elements - demonstrates how elements are ordered by z-index',
        category: 'advanced',
        html: `<div style="width: 600px; height: 400px; background: #f0f0f0; position: relative; font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="margin: 0 0 20px 0; color: #333;">Z-Index Sorting Test</h2>
            <p style="margin: 0 0 20px 0; color: #666;">Elements should be sorted by z-index (higher z-index appears later in children array)</p>
            
            <!-- Container with mixed z-index children -->
            <div style="position: relative; width: 500px; height: 300px; background: #e0e0e0; border: 2px solid #ccc; border-radius: 8px; padding: 20px;">
                
                <!-- Element with z-index 10 -->
                <div style="position: absolute; top: 50px; left: 50px; width: 120px; height: 80px; background: #ff6b6b; color: white; z-index: 10; display: flex; align-items: center; justify-content: center; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    Z-Index: 10
                </div>
                
                <!-- Element with z-index 5 -->
                <div style="position: absolute; top: 80px; left: 100px; width: 120px; height: 80px; background: #4ecdc4; color: white; z-index: 5; display: flex; align-items: center; justify-content: center; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    Z-Index: 5
                </div>
                
                <!-- Element with z-index 20 (should be on top) -->
                <div style="position: absolute; top: 110px; left: 150px; width: 120px; height: 80px; background: #45b7d1; color: white; z-index: 20; display: flex; align-items: center; justify-content: center; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    Z-Index: 20
                </div>
                
                <!-- Element with z-index 1 -->
                <div style="position: absolute; top: 140px; left: 200px; width: 120px; height: 80px; background: #f7b731; color: white; z-index: 1; display: flex; align-items: center; justify-content: center; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    Z-Index: 1
                </div>
                
                <!-- Element with no z-index (auto/0) -->
                <div style="position: absolute; top: 170px; left: 250px; width: 120px; height: 80px; background: #5f27cd; color: white; display: flex; align-items: center; justify-content: center; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    Z-Index: auto
                </div>
                
                <!-- Element with same z-index as first (should maintain DOM order) -->
                <div style="position: absolute; top: 200px; left: 300px; width: 120px; height: 80px; background: #ff9ff3; color: white; z-index: 10; display: flex; align-items: center; justify-content: center; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    Z-Index: 10 (2nd)
                </div>
                
                <!-- Element with negative z-index -->
                <div style="position: absolute; top: 30px; left: 350px; width: 120px; height: 80px; background: #ee5a24; color: white; z-index: -1; display: flex; align-items: center; justify-content: center; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    Z-Index: -1
                </div>
            </div>
            
            <!-- Expected order in Figma children array (from first to last): -->
            <!-- 1. Z-Index: -1 -->
            <!-- 2. Z-Index: auto (0) -->
            <!-- 3. Z-Index: 1 -->
            <!-- 4. Z-Index: 5 -->
            <!-- 5. Z-Index: 10 (first one in DOM) -->
            <!-- 6. Z-Index: 10 (2nd) (second one in DOM) -->
            <!-- 7. Z-Index: 20 -->
            
            <div style="margin-top: 20px; padding: 15px; background: #fff; border-radius: 4px; border-left: 4px solid #007bff;">
                <h4 style="margin: 0 0 10px 0; color: #333;">Expected Order in Figma:</h4>
                <ol style="margin: 0; padding-left: 20px; color: #666; font-size: 14px;">
                    <li>Z-Index: -1 (lowest)</li>
                    <li>Z-Index: auto (0)</li>
                    <li>Z-Index: 1</li>
                    <li>Z-Index: 5</li>
                    <li>Z-Index: 10 (first in DOM)</li>
                    <li>Z-Index: 10 (2nd) (second in DOM)</li>
                    <li>Z-Index: 20 (highest)</li>
                </ol>
            </div>
        </div>`
    },
    {
        name: '[Layout] CSS Grid Layout Test',
        description: 'Comprehensive test for CSS Grid layouts with grid-template-columns/rows and child positioning',
        category: 'layout',
        html: `<div style="padding: 20px; background-color: #f5f5f5; font-family: Arial, sans-serif;">
    <h2 style="margin: 0 0 20px 0; color: #333;">CSS Grid 布局测试</h2>
    
    <!-- Test 1: Simple 3-column grid -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">1. 简单三列网格 (grid-template-columns: 1fr 1fr 1fr)</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; background-color: #e3f2fd; padding: 15px; border-radius: 8px;">
            <div style="background-color: #2196f3; color: white; padding: 20px; text-align: center; border-radius: 4px;">项目 1</div>
            <div style="background-color: #1976d2; color: white; padding: 20px; text-align: center; border-radius: 4px;">项目 2</div>
            <div style="background-color: #0d47a1; color: white; padding: 20px; text-align: center; border-radius: 4px;">项目 3</div>
        </div>
    </div>

    <!-- Test 2: Mixed column sizes -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">2. 混合列尺寸 (grid-template-columns: 200px 1fr 100px)</h3>
        <div style="display: grid; grid-template-columns: 200px 1fr 100px; gap: 15px; background-color: #f3e5f5; padding: 15px; border-radius: 8px;">
            <div style="background-color: #9c27b0; color: white; padding: 15px; text-align: center; border-radius: 4px;">固定 200px</div>
            <div style="background-color: #7b1fa2; color: white; padding: 15px; text-align: center; border-radius: 4px;">弹性 1fr</div>
            <div style="background-color: #4a148c; color: white; padding: 15px; text-align: center; border-radius: 4px;">固定 100px</div>
        </div>
    </div>

    <!-- Test 3: 2D Grid with rows and columns -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">3. 二维网格 (grid-template: repeat(2, 1fr) / repeat(3, 1fr))</h3>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 80px); gap: 10px; background-color: #e8f5e8; padding: 15px; border-radius: 8px;">
            <div style="background-color: #4caf50; color: white; padding: 10px; text-align: center; border-radius: 4px;">1,1</div>
            <div style="background-color: #388e3c; color: white; padding: 10px; text-align: center; border-radius: 4px;">1,2</div>
            <div style="background-color: #2e7d32; color: white; padding: 10px; text-align: center; border-radius: 4px;">1,3</div>
            <div style="background-color: #1b5e20; color: white; padding: 10px; text-align: center; border-radius: 4px;">2,1</div>
            <div style="background-color: #4caf50; color: white; padding: 10px; text-align: center; border-radius: 4px;">2,2</div>
            <div style="background-color: #388e3c; color: white; padding: 10px; text-align: center; border-radius: 4px;">2,3</div>
        </div>
    </div>

    <!-- Test 4: Grid with spanning elements -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">4. 跨越网格项 (grid-column/grid-row spanning)</h3>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(3, 60px); gap: 10px; background-color: #fff3e0; padding: 15px; border-radius: 8px;">
            <div style="background-color: #ff9800; color: white; padding: 10px; text-align: center; border-radius: 4px; grid-column: 1 / 3;">跨 2 列</div>
            <div style="background-color: #f57c00; color: white; padding: 10px; text-align: center; border-radius: 4px;">正常</div>
            <div style="background-color: #ef6c00; color: white; padding: 10px; text-align: center; border-radius: 4px; grid-row: 1 / 3;">跨 2 行</div>
            <div style="background-color: #e65100; color: white; padding: 10px; text-align: center; border-radius: 4px;">正常</div>
            <div style="background-color: #ff9800; color: white; padding: 10px; text-align: center; border-radius: 4px;">正常</div>
            <div style="background-color: #f57c00; color: white; padding: 10px; text-align: center; border-radius: 4px;">正常</div>
            <div style="background-color: #ff9800; color: white; padding: 10px; text-align: center; border-radius: 4px; grid-column: 1 / 4;">跨 3 列</div>
            <div style="background-color: #ef6c00; color: white; padding: 10px; text-align: center; border-radius: 4px;">最后</div>
        </div>
    </div>

    <!-- Test 5: Grid with named areas -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">5. 命名网格区域 (grid-template-areas)</h3>
        <div style="display: grid; 
                    grid-template-columns: 200px 1fr 150px;
                    grid-template-rows: 60px 1fr 50px;
                    grid-template-areas: 
                        'header header header'
                        'sidebar content aside'
                        'footer footer footer';
                    gap: 10px; 
                    height: 300px;
                    background-color: #fce4ec; 
                    padding: 15px; 
                    border-radius: 8px;">
            <div style="background-color: #e91e63; color: white; padding: 10px; text-align: center; border-radius: 4px; grid-area: header;">Header</div>
            <div style="background-color: #c2185b; color: white; padding: 10px; text-align: center; border-radius: 4px; grid-area: sidebar;">Sidebar</div>
            <div style="background-color: #ad1457; color: white; padding: 10px; text-align: center; border-radius: 4px; grid-area: content;">Main Content</div>
            <div style="background-color: #880e4f; color: white; padding: 10px; text-align: center; border-radius: 4px; grid-area: aside;">Aside</div>
            <div style="background-color: #e91e63; color: white; padding: 10px; text-align: center; border-radius: 4px; grid-area: footer;">Footer</div>
        </div>
    </div>

    <!-- Test 6: Grid alignment -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">6. 网格对齐 (justify-items, align-items)</h3>
        <div style="display: grid; 
                    grid-template-columns: repeat(3, 150px); 
                    grid-template-rows: repeat(2, 100px);
                    gap: 15px; 
                    justify-items: center;
                    align-items: center;
                    background-color: #e0f2f1; 
                    padding: 20px; 
                    border-radius: 8px;">
            <div style="background-color: #009688; color: white; padding: 15px; border-radius: 4px;">居中 1</div>
            <div style="background-color: #00796b; color: white; padding: 15px; border-radius: 4px;">居中 2</div>
            <div style="background-color: #00695c; color: white; padding: 15px; border-radius: 4px;">居中 3</div>
            <div style="background-color: #004d40; color: white; padding: 15px; border-radius: 4px;">居中 4</div>
            <div style="background-color: #009688; color: white; padding: 15px; border-radius: 4px;">居中 5</div>
            <div style="background-color: #00796b; color: white; padding: 15px; border-radius: 4px;">居中 6</div>
        </div>
    </div>

    <!-- Test 7: Auto-fit and minmax -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">7. 响应式网格 (repeat(auto-fit, minmax(150px, 1fr)))</h3>
        <div style="display: grid; 
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); 
                    gap: 15px; 
                    background-color: #f1f8e9; 
                    padding: 15px; 
                    border-radius: 8px;">
            <div style="background-color: #8bc34a; color: white; padding: 20px; text-align: center; border-radius: 4px;">自适应 1</div>
            <div style="background-color: #7cb342; color: white; padding: 20px; text-align: center; border-radius: 4px;">自适应 2</div>
            <div style="background-color: #689f38; color: white; padding: 20px; text-align: center; border-radius: 4px;">自适应 3</div>
            <div style="background-color: #558b2f; color: white; padding: 20px; text-align: center; border-radius: 4px;">自适应 4</div>
        </div>
    </div>

    <!-- Test 8: Nested grids -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">8. 嵌套网格</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; background-color: #fafafa; padding: 15px; border-radius: 8px;">
            <div style="background-color: #607d8b; color: white; padding: 15px; border-radius: 4px;">
                <h4 style="margin: 0 0 10px 0;">左侧网格</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div style="background-color: #455a64; padding: 10px; border-radius: 4px; font-size: 14px;">子项 1</div>
                    <div style="background-color: #37474f; padding: 10px; border-radius: 4px; font-size: 14px;">子项 2</div>
                    <div style="background-color: #263238; padding: 10px; border-radius: 4px; font-size: 14px;">子项 3</div>
                    <div style="background-color: #455a64; padding: 10px; border-radius: 4px; font-size: 14px;">子项 4</div>
                </div>
            </div>
            <div style="background-color: #795548; color: white; padding: 15px; border-radius: 4px;">
                <h4 style="margin: 0 0 10px 0;">右侧内容</h4>
                <p style="margin: 0; font-size: 14px;">这是一个普通的内容区域，与左侧的嵌套网格形成对比。</p>
            </div>
        </div>
    </div>
</div>`
    },
    {
        name: '[Layout] Grid with Positioned Elements Test',
        description: 'Test CSS Grid layout with fixed and absolute positioned elements - verifies that positioned elements are excluded from grid restructuring',
        category: 'layout',
        html: `<div style="padding: 20px; background-color: #f5f5f5; font-family: Arial, sans-serif;">
    <h2 style="margin: 0 0 20px 0; color: #333;">网格布局 + 定位元素测试</h2>
    
    <!-- Test 1: Grid with absolute positioned overlay -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">1. 网格 + 绝对定位覆盖层</h3>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 100px); gap: 15px; background-color: #e3f2fd; padding: 20px; border-radius: 8px; position: relative;">
            <div style="background-color: #2196f3; color: white; padding: 15px; text-align: center; border-radius: 4px;">网格项 1</div>
            <div style="background-color: #1976d2; color: white; padding: 15px; text-align: center; border-radius: 4px;">网格项 2</div>
            <div style="background-color: #0d47a1; color: white; padding: 15px; text-align: center; border-radius: 4px;">网格项 3</div>
            <div style="background-color: #1565c0; color: white; padding: 15px; text-align: center; border-radius: 4px;">网格项 4</div>
            <div style="background-color: #1976d2; color: white; padding: 15px; text-align: center; border-radius: 4px;">网格项 5</div>
            <div style="background-color: #2196f3; color: white; padding: 15px; text-align: center; border-radius: 4px;">网格项 6</div>
            
            <!-- 绝对定位的覆盖层 - 应该被排除在网格重构之外 -->
            <div style="position: absolute; top: 10px; right: 10px; background-color: rgba(255, 0, 0, 0.9); color: white; padding: 8px 12px; border-radius: 4px; font-size: 12px; z-index: 10;">
                绝对定位覆盖层
            </div>
            
            <!-- 另一个绝对定位元素 -->
            <div style="position: absolute; bottom: 10px; left: 10px; background-color: rgba(255, 152, 0, 0.9); color: white; padding: 6px 10px; border-radius: 4px; font-size: 11px; z-index: 10;">
                Absolute Badge
            </div>
        </div>
    </div>

    <!-- Test 2: Grid with fixed positioned elements -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">2. 网格 + 固定定位元素</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, 120px); gap: 20px; background-color: #f3e5f5; padding: 20px; border-radius: 8px; position: relative;">
            <div style="background-color: #9c27b0; color: white; padding: 20px; text-align: center; border-radius: 4px;">
                <h4 style="margin: 0 0 10px 0;">网格项 A</h4>
                <p style="margin: 0; font-size: 14px;">正常的网格项目</p>
            </div>
            <div style="background-color: #7b1fa2; color: white; padding: 20px; text-align: center; border-radius: 4px;">
                <h4 style="margin: 0 0 10px 0;">网格项 B</h4>
                <p style="margin: 0; font-size: 14px;">正常的网格项目</p>
            </div>
            <div style="background-color: #4a148c; color: white; padding: 20px; text-align: center; border-radius: 4px;">
                <h4 style="margin: 0 0 10px 0;">网格项 C</h4>
                <p style="margin: 0; font-size: 14px;">正常的网格项目</p>
            </div>
            <div style="background-color: #6a1b9a; color: white; padding: 20px; text-align: center; border-radius: 4px;">
                <h4 style="margin: 0 0 10px 0;">网格项 D</h4>
                <p style="margin: 0; font-size: 14px;">正常的网格项目</p>
            </div>
            
            <!-- 固定定位的通知栏 - 应该被排除在网格重构之外 -->
            <div style="position: fixed; top: 50px; right: 20px; background-color: #ff5722; color: white; padding: 10px 15px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); z-index: 1000;">
                <strong>固定通知</strong><br>
                <small>position: fixed</small>
            </div>
        </div>
    </div>

    <!-- Test 3: Complex grid with mixed positioning -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">3. 复杂网格 + 混合定位</h3>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(2, 80px); gap: 10px; background-color: #e8f5e8; padding: 20px; border-radius: 8px; position: relative;">
            <!-- 正常网格项 -->
            <div style="background-color: #4caf50; color: white; padding: 10px; text-align: center; border-radius: 4px;">1</div>
            <div style="background-color: #388e3c; color: white; padding: 10px; text-align: center; border-radius: 4px;">2</div>
            <div style="background-color: #2e7d32; color: white; padding: 10px; text-align: center; border-radius: 4px;">3</div>
            <div style="background-color: #1b5e20; color: white; padding: 10px; text-align: center; border-radius: 4px;">4</div>
            <div style="background-color: #4caf50; color: white; padding: 10px; text-align: center; border-radius: 4px;">5</div>
            <div style="background-color: #388e3c; color: white; padding: 10px; text-align: center; border-radius: 4px;">6</div>
            <div style="background-color: #2e7d32; color: white; padding: 10px; text-align: center; border-radius: 4px;">7</div>
            <div style="background-color: #1b5e20; color: white; padding: 10px; text-align: center; border-radius: 4px;">8</div>
            
            <!-- 绝对定位的角标 -->
            <div style="position: absolute; top: 5px; left: 5px; width: 20px; height: 20px; background-color: #e91e63; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; z-index: 5;">
                !
            </div>
            
            <!-- 绝对定位的右上角徽章 -->
            <div style="position: absolute; top: -5px; right: -5px; background-color: #ff9800; color: white; padding: 4px 8px; border-radius: 12px; font-size: 10px; font-weight: bold; z-index: 5;">
                NEW
            </div>
            
            <!-- 固定定位的浮动按钮 -->
            <div style="position: fixed; bottom: 30px; right: 30px; width: 50px; height: 50px; background-color: #2196f3; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000;">
                +
            </div>
        </div>
    </div>

    <!-- Test 4: Nested grid with positioned elements -->
    <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: #666;">4. 嵌套网格 + 定位元素</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; background-color: #fff3e0; padding: 20px; border-radius: 8px; position: relative;">
            <div style="background-color: #ff9800; color: white; padding: 15px; border-radius: 4px; position: relative;">
                <h4 style="margin: 0 0 10px 0;">左侧网格容器</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div style="background-color: #f57c00; padding: 8px; border-radius: 4px; font-size: 12px;">子项 1</div>
                    <div style="background-color: #ef6c00; padding: 8px; border-radius: 4px; font-size: 12px;">子项 2</div>
                    <div style="background-color: #e65100; padding: 8px; border-radius: 4px; font-size: 12px;">子项 3</div>
                    <div style="background-color: #f57c00; padding: 8px; border-radius: 4px; font-size: 12px;">子项 4</div>
                </div>
                
                <!-- 嵌套容器内的绝对定位元素 -->
                <div style="position: absolute; top: 5px; right: 5px; width: 15px; height: 15px; background-color: #e91e63; border-radius: 50%; z-index: 3;"></div>
            </div>
            
            <div style="background-color: #795548; color: white; padding: 15px; border-radius: 4px; position: relative;">
                <h4 style="margin: 0 0 10px 0;">右侧内容</h4>
                <p style="margin: 0; font-size: 14px;">这是普通内容区域</p>
                
                <!-- 另一个绝对定位元素 -->
                <div style="position: absolute; bottom: 5px; right: 5px; background-color: #4caf50; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; z-index: 3;">
                    OK
                </div>
            </div>
            
            <!-- 外层容器的固定定位元素 -->
            <div style="position: fixed; top: 100px; left: 50%; transform: translateX(-50%); background-color: rgba(0, 0, 0, 0.8); color: white; padding: 8px 12px; border-radius: 4px; font-size: 12px; z-index: 2000;">
                嵌套测试通知
            </div>
        </div>
    </div>

    <div style="margin-top: 20px; padding: 15px; background-color: #fff; border-radius: 4px; border-left: 4px solid #2196f3;">
        <h4 style="margin: 0 0 10px 0; color: #333;">测试说明：</h4>
        <ul style="margin: 0; padding-left: 20px; color: #666; font-size: 14px;">
            <li>网格重构时应该忽略 <code>position: fixed</code> 和 <code>position: absolute</code> 的元素</li>
            <li>定位元素应该在重构完成后重新添加到容器的最上层</li>
            <li>只有正常流中的元素参与网格行重构</li>
            <li>定位元素保持原有的层级关系和定位属性</li>
        </ul>
    </div>
</div>`
    },
    {
        name: '[Advanced] Position Fixed Test',
        description: 'Test template for position: fixed elements - demonstrates how fixed positioning is handled',
        category: 'advanced',
        html: `<div style="padding: 20px; background-color: #f5f5f5; font-family: Arial, sans-serif; min-height: 400px; position: relative;">
    <h2 style="margin: 0 0 20px 0; color: #333;">固定定位测试 (Position Fixed Test)</h2>
    
    <!-- Test 1: Fixed header -->
    <div style="position: fixed; top: 0; left: 0; right: 0; background-color: #1976d2; color: white; padding: 10px 20px; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h3 style="margin: 0; font-size: 18px;">固定头部 (Fixed Header)</h3>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">这个元素使用 position: fixed; top: 0; 应该固定在视口顶部</p>
    </div>
    
    <!-- Test 2: Fixed sidebar -->
    <div style="position: fixed; top: 80px; right: 0; width: 200px; background-color: #4caf50; color: white; padding: 15px; z-index: 999;">
        <h4 style="margin: 0 0 10px 0;">固定侧边栏</h4>
        <p style="margin: 0; font-size: 14px;">position: fixed; right: 0; top: 80px;</p>
    </div>
    
    <!-- Test 3: Fixed bottom notification -->
    <div style="position: fixed; bottom: 20px; left: 20px; background-color: #ff9800; color: white; padding: 12px 16px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
        <strong>通知消息</strong><br>
        <small>position: fixed; bottom: 20px; left: 20px;</small>
    </div>
    
    <!-- Test 4: Fixed bottom edge (bottom: 0) -->
    <div style="position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); background-color: #e91e63; color: white; padding: 10px 20px; width: 200px; text-align: center;">
        <strong>底部边缘</strong><br>
        <small>position: fixed; bottom: 0;</small>
    </div>
    
    <!-- Test 5: Fixed center modal -->
    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: white; border: 2px solid #e0e0e0; border-radius: 8px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1001;">
        <h4 style="margin: 0 0 10px 0; color: #333;">居中模态框</h4>
        <p style="margin: 0; color: #666;">使用 position: fixed 和 transform 居中</p>
    </div>
    
    <!-- Normal content for context -->
    <div style="margin-top: 100px; padding: 20px; background-color: #e8f5e8; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0; color: #2e7d32;">普通内容区域</h3>
        <p style="margin: 0 0 10px 0; color: #333;">这是正常的文档流内容，用于对比固定定位元素。</p>
        <p style="margin: 0; color: #333;">固定定位的元素应该脱离文档流，不影响其他元素的布局。</p>
    </div>
    
    <div style="margin-top: 20px; padding: 20px; background-color: #fff3e0; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0; color: #ef6c00;">更多内容</h3>
        <p style="margin: 0; color: #333;">更多正常内容用于测试滚动时固定定位元素的行为。</p>
    </div>
</div>`
    },
    {
        name: '[Advanced] Margin Wrapper Test',
        description: 'Test template for margin wrapper functionality - demonstrates how margins are converted to outer Frame padding',
        category: 'advanced',
        html: `<div style="padding: 20px; background-color: #f5f5f5; font-family: Arial, sans-serif;">
    <h2 style="margin: 0 0 20px 0; color: #333;">外边距包装器测试 (Margin Wrapper Test)</h2>
    
    <!-- Test 1: All-around margin -->
    <div style="margin: 20px; background-color: #e3f2fd; padding: 15px; border: 2px solid #2196f3; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0; color: #1976d2;">全方向外边距 (20px)</h3>
        <p style="margin: 0; color: #333;">这个元素有 20px 的全方向外边距，应该被包装在外层 Frame 中</p>
    </div>
    
    <!-- Test 2: Top-bottom margin -->
    <div style="margin: 15px 0; background-color: #f3e5f5; padding: 15px; border: 2px solid #9c27b0; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0; color: #7b1fa2;">上下外边距 (15px 0)</h3>
        <p style="margin: 0; color: #333;">这个元素只有上下外边距</p>
    </div>
    
    <!-- Test 3: Left-right margin -->
    <div style="margin: 0 25px; background-color: #e8f5e8; padding: 15px; border: 2px solid #4caf50; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0; color: #388e3c;">左右外边距 (0 25px)</h3>
        <p style="margin: 0; color: #333;">这个元素只有左右外边距</p>
    </div>
    
    <!-- Test 4: Individual margin values -->
    <div style="margin: 10px 15px 20px 25px; background-color: #fff3e0; padding: 15px; border: 2px solid #ff9800; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0; color: #f57c00;">不同外边距值 (10px 15px 20px 25px)</h3>
        <p style="margin: 0; color: #333;">上10px，右15px，下20px，左25px</p>
    </div>
    
    <!-- Test 5: No margin control -->
    <div style="background-color: #ffebee; padding: 15px; border: 2px solid #f44336; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0; color: #d32f2f;">无外边距对照组</h3>
        <p style="margin: 0; color: #333;">这个元素没有外边距，不应该被包装</p>
    </div>
    
    <!-- Test 6: Flexbox with margins -->
    <div style="display: flex; gap: 10px; margin: 15px; background-color: #f0f4c3; padding: 15px; border: 2px dashed #827717; border-radius: 8px;">
        <div style="margin: 8px; background-color: #e1bee7; padding: 10px; border: 1px solid #8e24aa; border-radius: 4px; flex: 1;">
            Flex 项目 1
        </div>
        <div style="margin: 8px; background-color: #e1bee7; padding: 10px; border: 1px solid #8e24aa; border-radius: 4px; flex: 1;">
            Flex 项目 2
        </div>
        <div style="margin: 8px; background-color: #e1bee7; padding: 10px; border: 1px solid #8e24aa; border-radius: 4px; flex: 1;">
            Flex 项目 3
        </div>
    </div>
    
    <!-- Test 7: Nested margins -->
    <div style="margin: 30px; background-color: #e0f2f1; padding: 20px; border: 2px solid #009688; border-radius: 8px;">
        <h3 style="margin: 0 0 15px 0; color: #00695c;">嵌套外边距 (外层30px)</h3>
        <div style="margin: 10px; background-color: #fff8e1; padding: 10px; border: 1px solid #ffc107; border-radius: 4px;">
            <p style="margin: 0; color: #333;">内层子元素 (10px外边距)</p>
        </div>
    </div>
</div>`
    },
    {
        name: '[Advanced] Style Filter Test',
        description: 'Test template for style filtering functionality',
        category: 'advanced',
        html: `<div style="padding: 20px; background-color: #f0f0f0; border: 2px solid #333; font-family: Arial, sans-serif;">
    <!-- Text element with text styles -->
    <p style="color: red; font-size: 18px; font-weight: bold; margin: 10px 0; border: 0px solid transparent;">
        This text should have color and font styles applied, but no border (width is 0).
    </p>
    
    <!-- Image element with text styles (should be filtered out) -->
    <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzMzOTgiLz48L3N2Zz4=" 
         style="width: 100px; height: 100px; color: blue; font-size: 24px; border: 1px solid #999;" 
         alt="Test image" />
    
    <!-- Div without text content (text styles should be filtered out) -->
    <div style="width: 200px; height: 50px; background-color: lightblue; color: green; font-size: 16px; border: 2px solid red;">
        <!-- This div has no text content, so text styles should be filtered -->
    </div>
    
    <!-- Div with text content (text styles should be kept) -->
    <div style="width: 200px; height: 50px; background-color: lightyellow; color: purple; font-size: 14px; border: 1px solid orange;">
        This div has text content
    </div>
    
    <!-- Button with mixed styles -->
    <button style="padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer;">
        Button with effective styles
    </button>
</div>`
    },
    {
        name: '[Basic] Welcome Card',
        description: 'A simple welcome card with gradient background',
        category: 'basic',
        html: `<div style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; color: white; font-family: Arial, sans-serif; max-width: 400px;">
    <h2 style="margin: 0 0 10px 0;">Welcome to Html2Figma!</h2>
    <p style="margin: 0 0 15px 0; opacity: 0.9;">This is a sample HTML element that demonstrates the conversion capabilities.</p>
    <button style="background: white; color: #667eea; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer;">
        Click Me
    </button>
</div>`
    },
    {
        name: '[Components] Product Card',
        description: 'E-commerce style product card',
        category: 'components',
        html: `<div style="background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; max-width: 300px; font-family: Arial, sans-serif;">
    <div style="width: 100%; height: 200px; background: linear-gradient(45deg, #ff6b6b, #4ecdc4);"></div>
    <div style="padding: 20px;">
        <h3 style="margin: 0 0 8px 0; color: #333; font-size: 18px;">Premium Product</h3>
        <p style="margin: 0 0 12px 0; color: #666; font-size: 14px; line-height: 1.4;">High-quality product with amazing features and great value.</p>
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 20px; font-weight: bold; color: #2ecc71;">$99.99</span>
            <button style="background: #3498db; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Add to Cart</button>
        </div>
    </div>
</div>`
    },
    {
        name: '[Layout] Navigation Bar',
        description: 'Modern navigation bar with logo and menu items',
        category: 'layout',
        html: `<nav style="background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 0 20px; font-family: Arial, sans-serif;">
    <div style="display: flex; justify-content: space-between; align-items: center; max-width: 1200px; margin: 0 auto; height: 60px;">
        <div style="font-size: 24px; font-weight: bold; color: #333;">Logo</div>
        <div style="display: flex; gap: 30px;">
            <a href="#" style="color: #333; text-decoration: none; font-weight: 500;">Home</a>
            <a href="#" style="color: #333; text-decoration: none; font-weight: 500;">About</a>
            <a href="#" style="color: #333; text-decoration: none; font-weight: 500;">Services</a>
            <a href="#" style="color: #333; text-decoration: none; font-weight: 500;">Contact</a>
        </div>
        <button style="background: #667eea; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Sign Up</button>
    </div>
</nav>`
    },
    {
        name: '[Layout] Feature Section',
        description: 'Three-column feature showcase',
        category: 'layout',
        html: `<section style="padding: 60px 20px; background: #f8f9fa; font-family: Arial, sans-serif;">
    <div style="max-width: 1200px; margin: 0 auto; text-align: center;">
        <h2 style="margin: 0 0 20px 0; font-size: 32px; color: #333;">Our Features</h2>
        <p style="margin: 0 0 40px 0; color: #666; font-size: 18px;">Discover what makes our product special</p>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 30px;">
            <div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <div style="width: 60px; height: 60px; background: #667eea; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px;">🚀</div>
                <h3 style="margin: 0 0 12px 0; color: #333;">Fast Performance</h3>
                <p style="margin: 0; color: #666; line-height: 1.6;">Lightning-fast performance that scales with your needs.</p>
            </div>
            <div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <div style="width: 60px; height: 60px; background: #2ecc71; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px;">🔒</div>
                <h3 style="margin: 0 0 12px 0; color: #333;">Secure</h3>
                <p style="margin: 0; color: #666; line-height: 1.6;">Enterprise-grade security to protect your data.</p>
            </div>
            <div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <div style="width: 60px; height: 60px; background: #e74c3c; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px;">💡</div>
                <h3 style="margin: 0 0 12px 0; color: #333;">Easy to Use</h3>
                <p style="margin: 0; color: #666; line-height: 1.6;">Intuitive interface that anyone can master quickly.</p>
            </div>
        </div>
    </div>
</section>`
    },
    {
        name: '[Components] Form Example',
        description: 'Contact form with modern styling',
        category: 'components',
        html: `<form style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 500px; font-family: Arial, sans-serif;">
    <h2 style="margin: 0 0 20px 0; color: #333; text-align: center;">Contact Us</h2>
    <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Name</label>
        <input type="text" style="width: 100%; padding: 12px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 16px;" placeholder="Your name">
    </div>
    <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Email</label>
        <input type="email" style="width: 100%; padding: 12px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 16px;" placeholder="your@email.com">
    </div>
    <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Message</label>
        <textarea style="width: 100%; padding: 12px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 16px; resize: vertical; height: 100px;" placeholder="Your message..."></textarea>
    </div>
    <button type="submit" style="width: 100%; background: #667eea; color: white; border: none; padding: 12px; border-radius: 6px; font-size: 16px; font-weight: 500; cursor: pointer;">Send Message</button>
</form>`
    },
    {
        name: '[Components] Form Controls Test',
        description: 'Comprehensive test of all form input types and select elements',
        category: 'components',
        html: `<div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; font-family: Arial, sans-serif;">
    <h2 style="margin: 0 0 30px 0; color: #333; text-align: center;">Form Controls Test</h2>
    
    <!-- Text Inputs -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
        <div>
            <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Text Input</label>
            <input type="text" value="Sample text" style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px;">
        </div>
        <div>
            <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Password Input</label>
            <input type="password" placeholder="Enter password" style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px;">
        </div>
        <div>
            <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Email Input</label>
            <input type="email" placeholder="user@example.com" style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px;">
        </div>
        <div>
            <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Number Input</label>
            <input type="number" value="42" min="0" max="100" style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px;">
        </div>
    </div>

    <!-- Select Elements -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
        <div>
            <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Country Select</label>
            <select style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px; background: white;">
                <option value="">Select a country</option>
                <option value="us" selected>United States</option>
                <option value="uk">United Kingdom</option>
                <option value="ca">Canada</option>
                <option value="au">Australia</option>
            </select>
        </div>
        <div>
            <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Priority Select</label>
            <select style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px; background: white;">
                <option value="low">Low Priority</option>
                <option value="medium" selected>Medium Priority</option>
                <option value="high">High Priority</option>
                <option value="urgent">Urgent</option>
            </select>
        </div>
    </div>

    <!-- Checkboxes and Radio Buttons -->
    <div style="margin-bottom: 30px;">
        <label style="display: block; margin-bottom: 10px; color: #555; font-weight: 500;">Preferences</label>
        <div style="display: flex; flex-wrap: wrap; gap: 15px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" checked style="width: 16px; height: 16px;">
                <span style="font-size: 14px; color: #333;">Email notifications</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" style="width: 16px; height: 16px;">
                <span style="font-size: 14px; color: #333;">SMS notifications</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" checked style="width: 16px; height: 16px;">
                <span style="font-size: 14px; color: #333;">Marketing updates</span>
            </label>
        </div>
    </div>

    <div style="margin-bottom: 30px;">
        <label style="display: block; margin-bottom: 10px; color: #555; font-weight: 500;">Account Type</label>
        <div style="display: flex; flex-wrap: wrap; gap: 15px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="radio" name="account" value="personal" checked style="width: 16px; height: 16px;">
                <span style="font-size: 14px; color: #333;">Personal</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="radio" name="account" value="business" style="width: 16px; height: 16px;">
                <span style="font-size: 14px; color: #333;">Business</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="radio" name="account" value="enterprise" style="width: 16px; height: 16px;">
                <span style="font-size: 14px; color: #333;">Enterprise</span>
            </label>
        </div>
    </div>

    <!-- Range and Color Inputs -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
        <div>
            <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Volume (75%)</label>
            <input type="range" min="0" max="100" value="75" style="width: 100%; height: 6px; background: #e1e5e9; border-radius: 3px;">
        </div>
        <div>
            <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Favorite Color</label>
            <input type="color" value="#667eea" style="width: 60px; height: 40px; border: 2px solid #e1e5e9; border-radius: 6px; cursor: pointer;">
        </div>
    </div>

    <!-- File Input -->
    <div style="margin-bottom: 30px;">
        <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Upload Document</label>
        <input type="file" style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px; background: white;">
    </div>

    <!-- Textarea -->
    <div style="margin-bottom: 30px;">
        <label style="display: block; margin-bottom: 5px; color: #555; font-weight: 500;">Comments</label>
        <textarea placeholder="Enter your comments here..." style="width: 100%; padding: 12px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px; resize: vertical; height: 80px;"></textarea>
    </div>

    <!-- Submit Buttons -->
    <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <input type="button" value="Cancel" style="background: #f8f9fa; color: #333; border: 2px solid #e1e5e9; padding: 10px 20px; border-radius: 6px; font-size: 14px; cursor: pointer;">
        <input type="submit" value="Submit Form" style="background: #667eea; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer;">
    </div>
</div>`
    },
    {
        name: '[Advanced] Dashboard Widget',
        description: 'Statistics dashboard widget',
        category: 'advanced',
        html: `<div style="background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); padding: 24px; max-width: 350px; font-family: Arial, sans-serif;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; color: #333; font-size: 18px;">Revenue</h3>
        <span style="background: #e8f5e8; color: #2ecc71; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 500;">+12.5%</span>
    </div>
    <div style="margin-bottom: 20px;">
        <div style="font-size: 32px; font-weight: bold; color: #333; margin-bottom: 4px;">$24,567</div>
        <div style="color: #666; font-size: 14px;">This month</div>
    </div>
    <div style="height: 60px; background: linear-gradient(90deg, #667eea 0%, #764ba2 100%); border-radius: 8px; position: relative; overflow: hidden;">
        <div style="position: absolute; bottom: 0; left: 10%; width: 8px; height: 40%; background: rgba(255,255,255,0.7); border-radius: 4px 4px 0 0;"></div>
        <div style="position: absolute; bottom: 0; left: 25%; width: 8px; height: 60%; background: rgba(255,255,255,0.7); border-radius: 4px 4px 0 0;"></div>
        <div style="position: absolute; bottom: 0; left: 40%; width: 8px; height: 30%; background: rgba(255,255,255,0.7); border-radius: 4px 4px 0 0;"></div>
        <div style="position: absolute; bottom: 0; left: 55%; width: 8px; height: 80%; background: rgba(255,255,255,0.9); border-radius: 4px 4px 0 0;"></div>
        <div style="position: absolute; bottom: 0; left: 70%; width: 8px; height: 50%; background: rgba(255,255,255,0.7); border-radius: 4px 4px 0 0;"></div>
        <div style="position: absolute; bottom: 0; left: 85%; width: 8px; height: 70%; background: rgba(255,255,255,0.7); border-radius: 4px 4px 0 0;"></div>
    </div>
</div>`
    },
    {
        name: '[Layout] Hero Section',
        description: 'Landing page hero section',
        category: 'layout',
        html: `<section style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 80px 20px; text-align: center; font-family: Arial, sans-serif;">                                   
    <div style="max-width: 800px; margin: 0 auto;">
        <h1 style="margin: 0 0 20px 0; font-size: 48px; font-weight: bold; line-height: 1.2;">Transform Your Ideas Into Reality</h1>                                                                                    
        <p style="margin: 0 0 30px 0; font-size: 20px; opacity: 0.9; line-height: 1.6;">Create stunning designs and convert them to Figma with our powerful HTML to Figma converter.</p>                                
        <div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap;">
            <button style="background: white; color: #667eea; border: none; padding: 15px 30px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;">Get Started</button>                           
            <button style="background: transparent; color: white; border: 2px solid white; padding: 15px 30px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;">Learn More</button>             
        </div>
    </div>
</section>`
    },
    {
        name: '[Advanced] Font Weight Test',
        description: 'Test different font weights for fontWeight field validation',
        category: 'advanced',
        html: `<div style="padding: 20px; font-family: Arial, sans-serif; background: #f5f5f5;">
    <h2 style="margin: 0 0 20px 0; color: #333;">Font Weight Test Cases</h2>
    
    <!-- Numeric font weights -->
    <p style="font-weight: 100; margin: 10px 0; font-size: 16px;">Font Weight 100 (Thin)</p>
    <p style="font-weight: 200; margin: 10px 0; font-size: 16px;">Font Weight 200 (Extra Light)</p>
    <p style="font-weight: 300; margin: 10px 0; font-size: 16px;">Font Weight 300 (Light)</p>
    <p style="font-weight: 400; margin: 10px 0; font-size: 16px;">Font Weight 400 (Normal)</p>
    <p style="font-weight: 500; margin: 10px 0; font-size: 16px;">Font Weight 500 (Medium)</p>
    <p style="font-weight: 600; margin: 10px 0; font-size: 16px;">Font Weight 600 (Semi Bold)</p>
    <p style="font-weight: 700; margin: 10px 0; font-size: 16px;">Font Weight 700 (Bold)</p>
    <p style="font-weight: 800; margin: 10px 0; font-size: 16px;">Font Weight 800 (Extra Bold)</p>
    <p style="font-weight: 900; margin: 10px 0; font-size: 16px;">Font Weight 900 (Black)</p>
    
    <!-- Named font weights -->
    <p style="font-weight: normal; margin: 10px 0; font-size: 16px;">Font Weight: normal</p>
    <p style="font-weight: bold; margin: 10px 0; font-size: 16px;">Font Weight: bold</p>
    <p style="font-weight: lighter; margin: 10px 0; font-size: 16px;">Font Weight: lighter</p>
    <p style="font-weight: bolder; margin: 10px 0; font-size: 16px;">Font Weight: bolder</p>
    
    <!-- Mixed with different elements -->
    <h3 style="font-weight: 300; margin: 15px 0 5px 0;">Light Heading (300)</h3>
    <strong style="font-weight: 800;">Strong with 800 weight</strong>
    <span style="font-weight: 500; display: block; margin: 10px 0;">Span with medium weight (500)</span>
</div>`
    },
    {
        name: '[Layout] Relative Flex Layout',
        category: 'layout',
        description: 'Test relative positioning with flex layout using auto layout',
        html: `<div style="
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    width: 300px;
    height: 200px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 12px;
    padding: 20px;
    gap: 15px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.1);
">
    <h3 style="
        margin: 0;
        color: white;
        font-size: 18px;
        font-weight: 600;
        text-align: center;
    ">Relative + Flex Container</h3>
    
    <div style="
        display: flex;
        flex-direction: row;
        gap: 10px;
        align-items: center;
    ">
        <div style="
            width: 60px;
            height: 60px;
            background: rgba(255,255,255,0.2);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 500;
        ">Item 1</div>
        
        <div style="
            width: 60px;
            height: 60px;
            background: rgba(255,255,255,0.2);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 500;
        ">Item 2</div>
        
        <div style="
            width: 60px;
            height: 60px;
            background: rgba(255,255,255,0.2);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 500;
        ">Item 3</div>
    </div>
    
    <p style="
        margin: 0;
        color: rgba(255,255,255,0.9);
        font-size: 14px;
        text-align: center;
    ">This container uses both position: relative and display: flex</p>
    
    <!-- 绝对定位元素，不参与flex布局 -->
    <div style="
        position: absolute;
        top: 10px;
        right: 10px;
        width: 20px;
        height: 20px;
        background: #ff6b6b;
        border-radius: 50%;
        border: 2px solid white;
    "></div>
</div>`
    },
    {
        name: '[Layout] Absolute Positioning Layout',
        category: 'layout',
        description: 'Test different absolute positioning layout scenarios',
        html: `<div style="
    position: relative;
    width: 400px;
    height: 300px;
    background: linear-gradient(45deg, #f0f0f0, #e0e0e0);
    border: 2px solid #ccc;
    border-radius: 8px;
    margin: 20px;
">
    <!-- 固定到左上角 (MIN, MIN) -->
    <div style="
        position: absolute;
        top: 20px;
        left: 20px;
        width: 80px;
        height: 40px;
        background: #4CAF50;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        font-size: 12px;
    ">TOP-LEFT</div>
    
    <!-- 固定到右上角 (MAX, MIN) -->
    <div style="
        position: absolute;
        top: 20px;
        right: 20px;
        width: 80px;
        height: 40px;
        background: #2196F3;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        font-size: 12px;
    ">TOP-RIGHT</div>
    
    <!-- 固定到左下角 (MIN, MAX) -->
    <div style="
        position: absolute;
        bottom: 20px;
        left: 20px;
        width: 80px;
        height: 40px;
        background: #FF9800;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        font-size: 12px;
    ">BOTTOM-LEFT</div>
    
    <!-- 固定到右下角 (MAX, MAX) -->
    <div style="
        position: absolute;
        bottom: 20px;
        right: 20px;
        width: 80px;
        height: 40px;
        background: #9C27B0;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        font-size: 12px;
    ">BOTTOM-RIGHT</div>
    
    <!-- 水平拉伸 (STRETCH, MIN) -->
    <div style="
        position: absolute;
        top: 80px;
        left: 20px;
        right: 20px;
        height: 30px;
        background: #F44336;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        font-size: 12px;
    ">HORIZONTAL STRETCH</div>
    
    <!-- 垂直拉伸 (MIN, STRETCH) -->
    <div style="
        position: absolute;
        left: 180px;
        top: 120px;
        bottom: 80px;
        width: 40px;
        background: #607D8B;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        font-size: 10px;
        writing-mode: vertical-rl;
    ">VERTICAL</div>
    
    <!-- 居中元素 -->
    <div style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 100px;
        height: 50px;
        background: #795548;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        font-size: 12px;
    ">CENTERED</div>
</div>`
    }
  ,
  {
      name: '[Basic] Italic and Pseudo Elements',
      description: 'Render i tag as text and include ::before/::after content',
      category: 'basic',
      html: `<div style="padding: 20px; background: #fafafa; border: 1px solid #eee; border-radius: 8px; font-family: Arial, sans-serif; color: #333;">
  <style>
    .with-pseudo::before { content: '<<'; color: #999; }
    .with-pseudo::after { content: '>>'; color: #999; }
  </style>
  <h3 style="margin: 0 0 12px 0;">i 标签渲染与伪元素</h3>
  <p style="margin: 0 0 8px 0;">普通文本 <i style="color: #d32f2f;">斜体文本</i> 继续。</p>
  <p style="margin: 0;">带伪元素： <i class="with-pseudo" style="font-size: 18px;">内容</i></p>
</div>`
  },
  {
      name: '[Basic] List Elements Test',
      description: 'Test ul, ol, and li elements conversion to frame nodes',
      category: 'basic',
      html: `<div style="padding: 20px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; font-family: Arial, sans-serif; color: #333;">
  <h3 style="margin: 0 0 16px 0; color: #495057;">列表元素测试</h3>
  
  <!-- 无序列表 -->
  <div style="margin-bottom: 24px;">
    <h4 style="margin: 0 0 8px 0; color: #6c757d;">无序列表 (ul + li)</h4>
    <ul style="margin: 0; padding-left: 0; list-style: none;">
      <li style="margin-bottom: 8px; padding: 12px; background: #e3f2fd; border-radius: 4px; border-left: 4px solid #2196f3;">
        第一个列表项 - 这是一个较长的文本内容，用于测试列表项的布局效果
      </li>
      <li style="margin-bottom: 8px; padding: 12px; background: #f3e5f5; border-radius: 4px; border-left: 4px solid #9c27b0;">
        第二个列表项
      </li>
      <li style="margin-bottom: 8px; padding: 12px; background: #e8f5e8; border-radius: 4px; border-left: 4px solid #4caf50;">
        第三个列表项，包含<strong>粗体文本</strong>和<em>斜体文本</em>
      </li>
    </ul>
  </div>
  
  <!-- 有序列表 -->
  <div style="margin-bottom: 24px;">
    <h4 style="margin: 0 0 8px 0; color: #6c757d;">有序列表 (ol + li)</h4>
    <ol style="margin: 0; padding-left: 0; list-style: none; counter-reset: item;">
      <li style="margin-bottom: 8px; padding: 12px; background: #fff3e0; border-radius: 4px; border-left: 4px solid #ff9800; counter-increment: item; position: relative;">
        <span style="position: absolute; left: -24px; top: 12px; width: 20px; height: 20px; background: #ff9800; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;">1</span>
        步骤一：准备工作
      </li>
      <li style="margin-bottom: 8px; padding: 12px; background: #fce4ec; border-radius: 4px; border-left: 4px solid #e91e63; counter-increment: item; position: relative;">
        <span style="position: absolute; left: -24px; top: 12px; width: 20px; height: 20px; background: #e91e63; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;">2</span>
        步骤二：执行操作
      </li>
      <li style="margin-bottom: 8px; padding: 12px; background: #e0f2f1; border-radius: 4px; border-left: 4px solid #009688; counter-increment: item; position: relative;">
        <span style="position: absolute; left: -24px; top: 12px; width: 20px; height: 20px; background: #009688; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;">3</span>
        步骤三：完成验证
      </li>
    </ol>
  </div>
  
  <!-- 嵌套列表 -->
  <div>
    <h4 style="margin: 0 0 8px 0; color: #6c757d;">嵌套列表</h4>
    <ul style="margin: 0; padding-left: 0; list-style: none;">
      <li style="margin-bottom: 8px; padding: 12px; background: #f1f8e9; border-radius: 4px;">
        主要类别 A
        <ul style="margin: 8px 0 0 0; padding-left: 0; list-style: none;">
          <li style="margin-bottom: 4px; padding: 8px; background: #c8e6c9; border-radius: 4px; margin-left: 20px;">
            子项目 A1
          </li>
          <li style="margin-bottom: 4px; padding: 8px; background: #c8e6c9; border-radius: 4px; margin-left: 20px;">
            子项目 A2
          </li>
        </ul>
      </li>
      <li style="margin-bottom: 8px; padding: 12px; background: #f1f8e9; border-radius: 4px;">
        主要类别 B
        <ul style="margin: 8px 0 0 0; padding-left: 0; list-style: none;">
          <li style="margin-bottom: 4px; padding: 8px; background: #c8e6c9; border-radius: 4px; margin-left: 20px;">
            子项目 B1
          </li>
        </ul>
      </li>
    </ul>
  </div>
</div>`
  },
  {
    name: '[Advanced] Adjacent Inline Elements Test',
    description: 'Test template for adjacent inline elements preprocessing - demonstrates how adjacent inline elements are wrapped',
    category: 'advanced',
    html: `<div style="padding: 20px; background-color: #f5f5f5; font-family: Arial, sans-serif;">
    <h2 style="margin: 0 0 20px 0; color: #333;">相邻行内元素预处理测试 (Adjacent Inline Elements Test)</h2>
    
    <!-- Test 1: Adjacent inline elements in block container -->
    <div style="margin-bottom: 30px; padding: 20px; background-color: #e3f2fd; border-radius: 8px;">
        <h3 style="margin: 0 0 15px 0; color: #1976d2;">测试1: Block 容器中的相邻 inline 元素</h3>
        <div style="display: block; background-color: white; padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
            <span style="background-color: #ffeb3b; padding: 4px 8px; margin: 2px;">Span 1</span>
            <span style="background-color: #4caf50; padding: 4px 8px; margin: 2px; color: white;">Span 2</span>
            <span style="background-color: #ff9800; padding: 4px 8px; margin: 2px; color: white;">Span 3</span>
            <div style="display: block; margin-top: 10px; background-color: #f0f0f0; padding: 10px;">Block 元素</div>
            <span style="background-color: #e91e63; padding: 4px 8px; margin: 2px; color: white;">Span 4</span>
            <span style="background-color: #9c27b0; padding: 4px 8px; margin: 2px; color: white;">Span 5</span>
        </div>
        <p style="margin: 10px 0 0 0; font-size: 14px; color: #666;">
            应该将相邻的 span 1-3 包装在一个 inline-block div 中，span 4-5 包装在另一个 inline-block div 中
        </p>
    </div>
    
    <!-- Test 2: Mixed inline and block elements -->
    <div style="margin-bottom: 30px; padding: 20px; background-color: #f3e5f5; border-radius: 8px;">
        <h3 style="margin: 0 0 15px 0; color: #7b1fa2;">测试2: 混合 inline 和 block 元素</h3>
        <div style="display: block; background-color: white; padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
            <strong style="background-color: #2196f3; color: white; padding: 4px 8px;">Strong</strong>
            <em style="background-color: #03a9f4; color: white; padding: 4px 8px;">Em</em>
            <code style="background-color: #00bcd4; color: white; padding: 4px 8px;">Code</code>
            <p style="display: block; margin: 10px 0; background-color: #e0f2f1; padding: 10px;">段落元素</p>
            <small style="background-color: #4caf50; color: white; padding: 4px 8px;">Small</small>
            <mark style="background-color: #8bc34a; color: black; padding: 4px 8px;">Mark</mark>
        </div>
        <p style="margin: 10px 0 0 0; font-size: 14px; color: #666;">
            相邻的 strong, em, code 应该被包装，small, mark 应该被包装
        </p>
    </div>
    
    <!-- Test 3: Single inline elements (should not be wrapped) -->
    <div style="margin-bottom: 30px; padding: 20px; background-color: #e8f5e8; border-radius: 8px;">
        <h3 style="margin: 0 0 15px 0; color: #2e7d32;">测试3: 单独的 inline 元素（不应该被包装）</h3>
        <div style="display: block; background-color: white; padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
            <span style="background-color: #ff5722; color: white; padding: 4px 8px;">独立 Span</span>
            <div style="display: block; margin: 10px 0; background-color: #fafafa; padding: 10px;">分隔的 Block</div>
            <strong style="background-color: #795548; color: white; padding: 4px 8px;">独立 Strong</strong>
        </div>
        <p style="margin: 10px 0 0 0; font-size: 14px; color: #666;">
            单独的 inline 元素不应该被包装，因为它们不是相邻的
        </p>
    </div>
    
    <!-- Test 4: Nested block containers -->
    <div style="margin-bottom: 30px; padding: 20px; background-color: #fff3e0; border-radius: 8px;">
        <h3 style="margin: 0 0 15px 0; color: #ef6c00;">测试4: 嵌套的 block 容器</h3>
        <div style="display: block; background-color: white; padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
            <span style="background-color: #ff9800; color: white; padding: 4px 8px;">外层 Span 1</span>
            <span style="background-color: #ff5722; color: white; padding: 4px 8px;">外层 Span 2</span>
            <div style="display: block; margin: 10px 0; padding: 15px; background-color: #f5f5f5; border-radius: 4px;">
                <span style="background-color: #3f51b5; color: white; padding: 4px 8px;">内层 Span 1</span>
                <span style="background-color: #9c27b0; color: white; padding: 4px 8px;">内层 Span 2</span>
                <span style="background-color: #e91e63; color: white; padding: 4px 8px;">内层 Span 3</span>
            </div>
            <span style="background-color: #607d8b; color: white; padding: 4px 8px;">外层 Span 3</span>
        </div>
        <p style="margin: 10px 0 0 0; font-size: 14px; color: #666;">
            外层和内层的相邻 inline 元素都应该分别被包装
        </p>
    </div>
</div>`
  },
  {
    name: '[Advanced] Multi-Level Relative Positioning',
    description: 'Test multi-level relative positioned elements with auto layout optimization',
    category: 'advanced',
    html: `<div style="width: 800px; padding: 20px; background: #f8f9fa; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 20px 0; color: #333;">Multi-Level Relative Positioning Test</h1>
        
        <!-- Level 1: Root relative container -->
        <div style="position: relative; background: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 2px solid #2196f3;">
            <h2 style="margin: 0 0 15px 0; color: #1976d2;">Level 1: Root Relative Container (relative)</h2>
            <p style="margin: 0 0 15px 0; color: #555;">This should use auto layout (VERTICAL) by default</p>
            
            <!-- Level 2: Nested relative container -->
            <div style="position: relative; background: #f3e5f5; padding: 15px; border-radius: 6px; margin-bottom: 15px; border: 2px solid #9c27b0;">
                <h3 style="margin: 0 0 10px 0; color: #7b1fa2;">Level 2: Nested Relative Container (relative)</h3>
                <p style="margin: 0 0 10px 0; color: #555;">This should also use auto layout (VERTICAL)</p>
                
                <!-- Level 3: Deep nested relative container -->
                <div style="position: relative; background: #fff3e0; padding: 12px; border-radius: 4px; margin-bottom: 10px; border: 2px solid #ff9800;">
                    <h4 style="margin: 0 0 8px 0; color: #f57c00;">Level 3: Deep Nested Relative (relative)</h4>
                    <p style="margin: 0 0 8px 0; color: #555;">This should use auto layout (VERTICAL) as well</p>
                    
                    <!-- Regular content in deep nested -->
                    <div style="background: #fff; padding: 8px; border-radius: 4px; border: 1px solid #ddd;">
                        <span style="color: #333;">Regular content in deeply nested relative container</span>
                    </div>
                    
                    <!-- Absolute positioned element in level 3 -->
                    <div style="position: absolute; top: 5px; right: 5px; width: 20px; height: 20px; background: #ff5722; border-radius: 50%; border: 2px solid white;"></div>
                </div>
                
                <!-- Another element in level 2 -->
                <div style="background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #ddd;">
                    <span style="color: #333;">Another element in level 2</span>
                </div>
                
                <!-- Absolute positioned element in level 2 -->
                <div style="position: absolute; bottom: 5px; right: 5px; width: 25px; height: 25px; background: #4caf50; border-radius: 50%; border: 2px solid white;"></div>
            </div>
            
            <!-- Another element in level 1 -->
            <div style="background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #ddd;">
                <span style="color: #333;">Another element in level 1</span>
            </div>
            
            <!-- Absolute positioned element in level 1 -->
            <div style="position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; background: #2196f3; border-radius: 50%; border: 2px solid white;"></div>
        </div>
        
        <p style="margin: 0; color: #666; font-size: 14px;">
            All relative positioned containers should use auto layout (VERTICAL) by default, 
            while absolute positioned elements should be positioned correctly within their relative parents.
        </p>
    </div>`
  },
  {
    name: '[Advanced] Relative + Flex Mixed Layout',
    description: 'Test relative positioned elements combined with flexbox layouts',
    category: 'advanced',
    html: `<div style="width: 800px; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 20px 0; color: #333;">Relative + Flex Mixed Layout Test</h1>
        
        <!-- Relative container with flex display -->
        <div style="position: relative; display: flex; gap: 20px; background: #e8f5e8; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 2px solid #4caf50;">
            <h2 style="position: absolute; top: -10px; left: 20px; background: #4caf50; color: white; padding: 4px 12px; border-radius: 4px; margin: 0; font-size: 14px;">Relative + Flex Container</h2>
            
            <div style="flex: 1; background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #ddd;">
                <h3 style="margin: 0 0 10px 0; color: #333;">Flex Item 1</h3>
                <p style="margin: 0; color: #666;">This is inside a relative+flex container</p>
            </div>
            
            <div style="flex: 1; background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #ddd;">
                <h3 style="margin: 0 0 10px 0; color: #333;">Flex Item 2</h3>
                <p style="margin: 0; color: #666;">Flex layout should work normally</p>
            </div>
            
            <div style="flex: 1; background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #ddd;">
                <h3 style="margin: 0 0 10px 0; color: #333;">Flex Item 3</h3>
                <p style="margin: 0; color: #666;">Absolute elements don't affect flex</p>
            </div>
            
            <!-- Absolute positioned overlay -->
            <div style="position: absolute; bottom: 10px; right: 10px; background: rgba(255,0,0,0.8); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">
                Absolute Overlay
            </div>
        </div>
        
        <!-- Relative container with vertical flex -->
        <div style="position: relative; display: flex; flex-direction: column; gap: 15px; background: #fff3e0; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 2px solid #ff9800;">
            <h2 style="margin: 0 0 10px 0; color: #f57c00;">Relative + Vertical Flex</h2>
            
            <div style="background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #ddd;">
                <span style="color: #333;">Vertical Flex Item 1</span>
            </div>
            
            <div style="background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #ddd;">
                <span style="color: #333;">Vertical Flex Item 2</span>
            </div>
            
            <div style="background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #ddd;">
                <span style="color: #333;">Vertical Flex Item 3</span>
            </div>
            
            <!-- Absolute positioned corner badge -->
            <div style="position: absolute; top: -5px; right: -5px; width: 25px; height: 25px; background: #ff5722; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;">
                !
            </div>
        </div>
        
        <!-- Nested relative containers with different flex directions -->
        <div style="position: relative; display: flex; gap: 20px; background: #f3e5f5; padding: 20px; border-radius: 8px; border: 2px solid #9c27b0;">
            <div style="position: relative; flex: 1; display: flex; flex-direction: column; gap: 10px; background: #fff; padding: 15px; border-radius: 6px;">
                <h3 style="margin: 0 0 10px 0; color: #7b1fa2;">Nested Relative + Vertical Flex</h3>
                <div style="background: #f5f5f5; padding: 8px; border-radius: 4px;">Item A</div>
                <div style="background: #f5f5f5; padding: 8px; border-radius: 4px;">Item B</div>
                <div style="position: absolute; top: 5px; right: 5px; width: 15px; height: 15px; background: #e91e63; border-radius: 50%;"></div>
            </div>
            
            <div style="position: relative; flex: 1; display: flex; gap: 10px; background: #fff; padding: 15px; border-radius: 6px;">
                <h3 style="position: absolute; top: -10px; left: 10px; background: #9c27b0; color: white; padding: 2px 8px; border-radius: 4px; margin: 0; font-size: 12px;">Nested Relative + Horizontal Flex</h3>
                <div style="background: #f5f5f5; padding: 8px; border-radius: 4px; margin-top: 20px;">X</div>
                <div style="background: #f5f5f5; padding: 8px; border-radius: 4px; margin-top: 20px;">Y</div>
                <div style="position: absolute; bottom: 5px; right: 5px; width: 15px; height: 15px; background: #00bcd4; border-radius: 50%;"></div>
            </div>
        </div>
        
        <p style="margin: 20px 0 0 0; color: #666; font-size: 14px;">
            Relative positioned containers with flex display should prioritize flex layout while still supporting absolute positioned children.
        </p>
    </div>`
  },
  {
    name: '[Advanced] Relative + Grid Mixed Layout',
    description: 'Test relative positioned elements combined with CSS Grid layouts',
    category: 'advanced',
    html: `<div style="width: 800px; padding: 20px; background: #f0f8ff; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 20px 0; color: #333;">Relative + Grid Mixed Layout Test</h1>
        
        <!-- Relative container with grid display -->
        <div style="position: relative; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; background: #e1f5fe; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 2px solid #03a9f4;">
            <h2 style="position: absolute; top: -10px; left: 20px; background: #03a9f4; color: white; padding: 4px 12px; border-radius: 4px; margin: 0; font-size: 14px;">Relative + Grid Container (3 columns)</h2>
            
            <div style="background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #ddd; margin-top: 20px;">
                <h3 style="margin: 0 0 8px 0; color: #333;">Grid Item 1</h3>
                <p style="margin: 0; color: #666; font-size: 14px;">First column</p>
            </div>
            
            <div style="background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #ddd; margin-top: 20px;">
                <h3 style="margin: 0 0 8px 0; color: #333;">Grid Item 2</h3>
                <p style="margin: 0; color: #666; font-size: 14px;">Second column</p>
            </div>
            
            <div style="background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #ddd; margin-top: 20px;">
                <h3 style="margin: 0 0 8px 0; color: #333;">Grid Item 3</h3>
                <p style="margin: 0; color: #666; font-size: 14px;">Third column</p>
            </div>
            
            <div style="background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #ddd;">
                <h3 style="margin: 0 0 8px 0; color: #333;">Grid Item 4</h3>
                <p style="margin: 0; color: #666; font-size: 14px;">Second row, first column</p>
            </div>
            
            <div style="background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #ddd; grid-column: span 2;">
                <h3 style="margin: 0 0 8px 0; color: #333;">Grid Item 5 (spans 2 columns)</h3>
                <p style="margin: 0; color: #666; font-size: 14px;">This item spans across two columns</p>
            </div>
            
            <!-- Absolute positioned element over grid -->
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(255,193,7,0.9); color: #333; padding: 10px; border-radius: 6px; font-weight: bold; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
                Centered Overlay
            </div>
        </div>
        
        <!-- Relative container with complex grid areas -->
        <div style="position: relative; display: grid; grid-template-areas: 'header header header' 'sidebar main main' 'footer footer footer'; grid-template-rows: auto 1fr auto; gap: 10px; background: #fff8e1; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 2px solid #ffc107; min-height: 200px;">
            <div style="grid-area: header; background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #ddd;">
                <h3 style="margin: 0; color: #333;">Header Area</h3>
            </div>
            
            <div style="grid-area: sidebar; background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #ddd;">
                <h4 style="margin: 0 0 8px 0; color: #333;">Sidebar</h4>
                <p style="margin: 0; color: #666; font-size: 14px;">Navigation menu</p>
            </div>
            
            <div style="grid-area: main; background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #ddd;">
                <h4 style="margin: 0 0 8px 0; color: #333;">Main Content</h4>
                <p style="margin: 0; color: #666; font-size: 14px;">This is the main content area of the grid layout</p>
            </div>
            
            <div style="grid-area: footer; background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #ddd;">
                <h4 style="margin: 0; color: #333;">Footer Area</h4>
            </div>
            
            <!-- Absolute positioned notification -->
            <div style="position: absolute; top: 10px; right: 10px; background: #f44336; color: white; padding: 6px 10px; border-radius: 4px; font-size: 12px;">
                New Message
            </div>
        </div>
        
        <!-- Nested relative + grid containers -->
        <div style="position: relative; background: #fce4ec; padding: 20px; border-radius: 8px; border: 2px solid #e91e63;">
            <h2 style="margin: 0 0 15px 0; color: #c2185b;">Nested Relative Containers with Grid</h2>
            
            <div style="position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: #fff; padding: 15px; border-radius: 6px;">
                <div style="position: relative; background: #f5f5f5; padding: 12px; border-radius: 4px;">
                    <h4 style="margin: 0 0 8px 0; color: #333;">Nested Grid Item 1</h4>
                    <p style="margin: 0; color: #666; font-size: 14px;">Contains relative positioning</p>
                    <div style="position: absolute; top: 2px; right: 2px; width: 12px; height: 12px; background: #4caf50; border-radius: 50%;"></div>
                </div>
                
                <div style="position: relative; background: #f5f5f5; padding: 12px; border-radius: 4px;">
                    <h4 style="margin: 0 0 8px 0; color: #333;">Nested Grid Item 2</h4>
                    <p style="margin: 0; color: #666; font-size: 14px;">Also has relative positioning</p>
                    <div style="position: absolute; bottom: 2px; left: 2px; width: 12px; height: 12px; background: #2196f3; border-radius: 50%;"></div>
                </div>
                
                <!-- Absolute element in nested grid container -->
                <div style="position: absolute; bottom: -5px; right: -5px; background: #ff5722; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px;">
                    Grid Badge
                </div>
            </div>
            
            <!-- Absolute element in outer relative container -->
            <div style="position: absolute; top: 5px; left: 5px; background: #9c27b0; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px;">
                Outer Badge
            </div>
        </div>
        
        <p style="margin: 20px 0 0 0; color: #666; font-size: 14px;">
            Relative positioned containers with grid display should use grid layout while maintaining proper positioning context for absolute children.
        </p>
    </div>`
  },
  {
    name: '[Advanced] Complex Nested Relative Positioning',
    description: 'Test complex scenarios with deeply nested relative positioned elements',
    category: 'advanced',
    html: `<div style="width: 900px; padding: 20px; background: #fafafa; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 20px 0; color: #333;">Complex Nested Relative Positioning Test</h1>
        
        <!-- Scenario 1: Relative with mixed content types -->
        <div style="position: relative; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; margin-bottom: 25px; color: white;">
            <h2 style="margin: 0 0 15px 0;">Scenario 1: Mixed Content Types</h2>
            
            <!-- Text content -->
            <p style="margin: 0 0 15px 0; line-height: 1.5;">
                This relative container contains various types of content: text, images, buttons, and nested containers.
            </p>
            
            <!-- Button group -->
            <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                <button style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Button 1</button>
                <button style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Button 2</button>
            </div>
            
            <!-- Nested relative container with form elements -->
            <div style="position: relative; background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; backdrop-filter: blur(10px);">
                <h3 style="margin: 0 0 12px 0;">Nested Form Container</h3>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                    <input type="text" placeholder="First Name" style="padding: 8px 12px; border: none; border-radius: 4px; background: rgba(255,255,255,0.9);">
                    <input type="text" placeholder="Last Name" style="padding: 8px 12px; border: none; border-radius: 4px; background: rgba(255,255,255,0.9);">
                </div>
                
                <textarea placeholder="Message" style="width: 100%; padding: 8px 12px; border: none; border-radius: 4px; background: rgba(255,255,255,0.9); resize: vertical; min-height: 60px; box-sizing: border-box;"></textarea>
                
                <!-- Deeply nested relative container -->
                <div style="position: relative; margin-top: 15px; background: rgba(0,0,0,0.1); padding: 15px; border-radius: 6px;">
                    <h4 style="margin: 0 0 8px 0;">Deep Nested Container</h4>
                    <p style="margin: 0 0 10px 0; font-size: 14px; opacity: 0.9;">
                        This container is 3 levels deep in relative positioning hierarchy.
                    </p>
                    
                    <!-- List with relative items -->
                    <ul style="margin: 0; padding: 0; list-style: none;">
                        <li style="position: relative; background: rgba(255,255,255,0.1); margin-bottom: 6px; padding: 8px 12px; border-radius: 4px;">
                            List Item 1
                            <span style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: #4caf50; color: white; padding: 2px 6px; border-radius: 10px; font-size: 11px;">New</span>
                        </li>
                        <li style="position: relative; background: rgba(255,255,255,0.1); margin-bottom: 6px; padding: 8px 12px; border-radius: 4px;">
                            List Item 2
                            <span style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: #ff9800; color: white; padding: 2px 6px; border-radius: 10px; font-size: 11px;">Hot</span>
                        </li>
                        <li style="position: relative; background: rgba(255,255,255,0.1); padding: 8px 12px; border-radius: 4px;">
                            List Item 3
                            <span style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: #f44336; color: white; padding: 2px 6px; border-radius: 10px; font-size: 11px;">!</span>
                        </li>
                    </ul>
                    
                    <!-- Absolute positioned element in deep container -->
                    <div style="position: absolute; top: -5px; right: -5px; width: 20px; height: 20px; background: #ffeb3b; border: 2px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: #333;">3</div>
                </div>
                
                <!-- Absolute positioned element in nested container -->
                <div style="position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); background: #e91e63; color: white; padding: 6px 12px; border-radius: 15px; font-size: 12px; white-space: nowrap;">Form Container</div>
            </div>
            
            <!-- Absolute positioned elements in main container -->
            <div style="position: absolute; top: 15px; right: 15px; background: rgba(255,255,255,0.2); padding: 8px; border-radius: 6px; backdrop-filter: blur(5px);">
                <span style="font-size: 12px;">Main Badge</span>
            </div>
            
            <div style="position: absolute; bottom: 15px; left: 15px; background: #ff5722; padding: 6px 10px; border-radius: 4px; font-size: 11px;">
                Level 1
            </div>
        </div>
        
        <!-- Scenario 2: Card layout with relative positioning -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 25px;">
            <div style="position: relative; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">
                <!-- Card header -->
                <div style="position: relative; background: linear-gradient(45deg, #ff6b6b, #ee5a24); padding: 20px; color: white;">
                    <h3 style="margin: 0 0 8px 0;">Card Title 1</h3>
                    <p style="margin: 0; opacity: 0.9; font-size: 14px;">Card subtitle with description</p>
                    <div style="position: absolute; top: 15px; right: 15px; width: 30px; height: 30px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                        <span style="font-size: 16px;">★</span>
                    </div>
                </div>
                
                <!-- Card body -->
                <div style="position: relative; padding: 20px;">
                    <p style="margin: 0 0 15px 0; color: #666; line-height: 1.5;">
                        This card contains relative positioned elements with various nested components.
                    </p>
                    
                    <!-- Progress bar -->
                    <div style="position: relative; background: #f0f0f0; height: 8px; border-radius: 4px; margin-bottom: 15px; overflow: hidden;">
                        <div style="position: absolute; top: 0; left: 0; height: 100%; width: 65%; background: linear-gradient(90deg, #4caf50, #8bc34a); border-radius: 4px;"></div>
                        <span style="position: absolute; top: -20px; right: 0; font-size: 12px; color: #666;">65%</span>
                    </div>
                    
                    <!-- Action buttons -->
                    <div style="display: flex; gap: 8px;">
                        <button style="flex: 1; background: #2196f3; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer;">Action</button>
                        <button style="background: transparent; color: #2196f3; border: 1px solid #2196f3; padding: 10px 16px; border-radius: 6px; cursor: pointer;">More</button>
                    </div>
                    
                    <!-- Absolute positioned notification -->
                    <div style="position: absolute; top: -10px; right: -10px; background: #f44336; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;">5</div>
                </div>
            </div>
            
            <div style="position: relative; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">
                <!-- Card header -->
                <div style="position: relative; background: linear-gradient(45deg, #4ecdc4, #44a08d); padding: 20px; color: white;">
                    <h3 style="margin: 0 0 8px 0;">Card Title 2</h3>
                    <p style="margin: 0; opacity: 0.9; font-size: 14px;">Another card with different content</p>
                    <div style="position: absolute; top: 15px; right: 15px; width: 30px; height: 30px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                        <span style="font-size: 16px;">♦</span>
                    </div>
                </div>
                
                <!-- Card body with nested relative containers -->
                <div style="position: relative; padding: 20px;">
                    <div style="position: relative; background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                        <h4 style="margin: 0 0 10px 0; color: #333;">Nested Section</h4>
                        <p style="margin: 0; color: #666; font-size: 14px;">Content within nested relative container</p>
                        <div style="position: absolute; top: 8px; right: 8px; background: #17a2b8; color: white; padding: 2px 6px; border-radius: 10px; font-size: 10px;">INFO</div>
                    </div>
                    
                    <!-- Tags -->
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        <span style="background: #e3f2fd; color: #1976d2; padding: 4px 8px; border-radius: 12px; font-size: 12px;">Tag 1</span>
                        <span style="background: #f3e5f5; color: #7b1fa2; padding: 4px 8px; border-radius: 12px; font-size: 12px;">Tag 2</span>
                        <span style="background: #fff3e0; color: #f57c00; padding: 4px 8px; border-radius: 12px; font-size: 12px;">Tag 3</span>
                    </div>
                </div>
            </div>
        </div>
        
        <p style="margin: 0; color: #666; font-size: 14px; line-height: 1.5;">
            This test demonstrates complex nested relative positioning scenarios including forms, cards, lists, and mixed content types. 
            All relative containers should use auto layout while maintaining proper positioning contexts for their absolute children.
        </p>
    </div>`
  },
  {
    name: '[Basic] Text - Multiple Inline Spans',
    description: 'Test multiple inline spans side by side with different styles',
    category: 'basic',
    html: `<div style="width: 800px; padding: 30px; background: #f8f9fa; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 30px 0; color: #333;">Multiple Inline Spans Test</h1>
        
        <!-- Basic inline spans -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Basic Inline Spans</h2>
            <p style="margin: 0; line-height: 1.8;">
                This is <span style="color: #e74c3c; font-weight: bold;">red bold text</span> and 
                <span style="color: #3498db; font-style: italic;">blue italic text</span> and 
                <span style="background: #f1c40f; padding: 2px 6px; border-radius: 3px;">highlighted text</span> 
                in the same paragraph.
            </p>
        </div>
        
        <!-- Inline spans with different sizes -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Different Font Sizes</h2>
            <div style="margin: 0;">
                <span style="font-size: 12px; color: #7f8c8d;">Small</span>
                <span style="font-size: 16px; color: #34495e; margin: 0 10px;">Medium</span>
                <span style="font-size: 24px; color: #2c3e50; font-weight: bold;">Large</span>
                <span style="font-size: 32px; color: #e74c3c; margin-left: 10px;">Extra Large</span>
            </div>
        </div>
        
        <!-- Inline spans with borders and backgrounds -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Styled Spans (Tags/Badges)</h2>
            <div style="margin: 0;">
                <span style="background: #e8f5e9; color: #2e7d32; padding: 6px 12px; border-radius: 4px; margin-right: 8px; display: inline-block;">Success</span>
                <span style="background: #fff3e0; color: #ef6c00; padding: 6px 12px; border-radius: 4px; margin-right: 8px; display: inline-block;">Warning</span>
                <span style="background: #ffebee; color: #c62828; padding: 6px 12px; border-radius: 4px; margin-right: 8px; display: inline-block;">Error</span>
                <span style="background: #e3f2fd; color: #1565c0; padding: 6px 12px; border-radius: 4px; display: inline-block;">Info</span>
            </div>
        </div>
        
        <!-- Inline spans with borders -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Bordered Spans</h2>
            <div style="margin: 0;">
                <span style="border: 2px solid #e74c3c; color: #e74c3c; padding: 4px 10px; border-radius: 20px; margin-right: 10px; display: inline-block;">Outlined Red</span>
                <span style="border: 2px solid #3498db; color: #3498db; padding: 4px 10px; border-radius: 20px; margin-right: 10px; display: inline-block;">Outlined Blue</span>
                <span style="border: 2px dashed #27ae60; color: #27ae60; padding: 4px 10px; border-radius: 4px; display: inline-block;">Dashed Green</span>
            </div>
        </div>
        
        <!-- Mixed inline elements -->
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Complex Inline Mix</h2>
            <p style="margin: 0; line-height: 2;">
                Visit <span style="color: #3498db; text-decoration: underline; cursor: pointer;">our website</span> to 
                learn more. Price: <span style="font-size: 20px; font-weight: bold; color: #e74c3c;">$99.99</span>
                <span style="font-size: 12px; color: #7f8c8d; text-decoration: line-through; margin-left: 8px;">$149.99</span>
                <span style="background: #27ae60; color: white; padding: 2px 8px; border-radius: 3px; margin-left: 8px; font-size: 12px; font-weight: bold;">SAVE 33%</span>
            </p>
        </div>
    </div>`
  },
  {
    name: '[Layout] Text - Flex Layout with Spans',
    description: 'Test spans in flex layouts with various display properties',
    category: 'layout',
    html: `<div style="width: 800px; padding: 30px; background: #f8f9fa; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 30px 0; color: #333;">Flex Layout with Spans Test</h1>
        
        <!-- Flex row with spans -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Flex Row - Space Between</h2>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                <span style="color: #333; font-weight: bold;">Label:</span>
                <span style="color: #666; flex: 1; text-align: center;">Center Content</span>
                <span style="color: #3498db; font-size: 14px;">View Details →</span>
            </div>
        </div>
        
        <!-- Flex row with nested spans -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Flex with Nested Spans</h2>
            <div style="display: flex; align-items: center; gap: 15px;">
                <span style="background: #3498db; color: white; padding: 10px 15px; border-radius: 6px; font-weight: bold;">
                    Category
                </span>
                <span style="display: flex; flex-direction: column; gap: 4px;">
                    <span style="font-weight: bold; color: #333;">Product Title</span>
                    <span style="font-size: 14px; color: #7f8c8d;">Product Description</span>
                </span>
                <span style="margin-left: auto; display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 20px; font-weight: bold; color: #27ae60;">$49.99</span>
                    <span style="background: #27ae60; color: white; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Add to Cart</span>
                </span>
            </div>
        </div>
        
        <!-- Flex column with spans -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Flex Column</h2>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <span style="font-size: 24px; font-weight: bold; color: #2c3e50;">Main Heading</span>
                <span style="color: #7f8c8d; line-height: 1.6;">This is a description text that spans multiple lines when needed. It demonstrates how text flows in a flex column layout.</span>
                <span style="display: flex; gap: 8px;">
                    <span style="background: #e74c3c; color: white; padding: 8px 16px; border-radius: 4px; display: inline-block;">Delete</span>
                    <span style="background: #95a5a6; color: white; padding: 8px 16px; border-radius: 4px; display: inline-block;">Cancel</span>
                    <span style="background: #3498db; color: white; padding: 8px 16px; border-radius: 4px; display: inline-block;">Save</span>
                </span>
            </div>
        </div>
        
        <!-- Flex wrap with spans -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Flex Wrap - Tags</h2>
            <div style="display: flex; flex-wrap: wrap; gap: 10px;">
                <span style="background: #ecf0f1; color: #2c3e50; padding: 8px 14px; border-radius: 20px; font-size: 14px;">JavaScript</span>
                <span style="background: #ecf0f1; color: #2c3e50; padding: 8px 14px; border-radius: 20px; font-size: 14px;">TypeScript</span>
                <span style="background: #ecf0f1; color: #2c3e50; padding: 8px 14px; border-radius: 20px; font-size: 14px;">React</span>
                <span style="background: #ecf0f1; color: #2c3e50; padding: 8px 14px; border-radius: 20px; font-size: 14px;">Vue.js</span>
                <span style="background: #ecf0f1; color: #2c3e50; padding: 8px 14px; border-radius: 20px; font-size: 14px;">Angular</span>
                <span style="background: #ecf0f1; color: #2c3e50; padding: 8px 14px; border-radius: 20px; font-size: 14px;">Node.js</span>
                <span style="background: #ecf0f1; color: #2c3e50; padding: 8px 14px; border-radius: 20px; font-size: 14px;">Python</span>
                <span style="background: #ecf0f1; color: #2c3e50; padding: 8px 14px; border-radius: 20px; font-size: 14px;">Django</span>
            </div>
        </div>
        
        <!-- Flex with different display spans -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Mixed Display Properties</h2>
            <div style="display: flex; align-items: flex-start; gap: 20px;">
                <span style="display: block; background: #3498db; color: white; padding: 15px; border-radius: 6px; min-width: 100px; text-align: center;">
                    <span style="display: block; font-size: 32px; font-weight: bold;">42</span>
                    <span style="display: block; font-size: 12px; margin-top: 4px;">Followers</span>
                </span>
                <span style="display: block; background: #9b59b6; color: white; padding: 15px; border-radius: 6px; min-width: 100px; text-align: center;">
                    <span style="display: block; font-size: 32px; font-weight: bold;">128</span>
                    <span style="display: block; font-size: 12px; margin-top: 4px;">Following</span>
                </span>
                <span style="display: block; background: #e74c3c; color: white; padding: 15px; border-radius: 6px; min-width: 100px; text-align: center;">
                    <span style="display: block; font-size: 32px; font-weight: bold;">89</span>
                    <span style="display: block; font-size: 12px; margin-top: 4px;">Posts</span>
                </span>
            </div>
        </div>
        
        <!-- Flex with align-items variations -->
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Flex Alignment</h2>
            <div style="display: flex; align-items: center; gap: 15px; padding: 15px; background: #f8f9fa; border-radius: 4px;">
                <span style="width: 50px; height: 50px; background: #e74c3c; color: white; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-weight: bold;">A</span>
                <span style="display: flex; flex-direction: column; gap: 4px; flex: 1;">
                    <span style="font-weight: bold; color: #333; font-size: 16px;">User Name</span>
                    <span style="color: #7f8c8d; font-size: 14px;">user@example.com</span>
                    <span style="display: flex; gap: 6px; margin-top: 4px;">
                        <span style="background: #d5e8d4; color: #27ae60; padding: 2px 8px; border-radius: 3px; font-size: 12px;">Active</span>
                        <span style="background: #dae8fc; color: #3498db; padding: 2px 8px; border-radius: 3px; font-size: 12px;">Premium</span>
                    </span>
                </span>
                <span style="color: #3498db; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 4px;">
                    Edit Profile →
                </span>
            </div>
        </div>
    </div>`
  },
  {
    name: '[Basic] Text - Pure Text in Divs',
    description: 'Test divs containing only text content without nested elements',
    category: 'basic',
    html: `<div style="width: 800px; padding: 30px; background: #f8f9fa; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 30px 0; color: #333;">Pure Text in Divs Test</h1>
        
        <!-- Basic text divs -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Basic Text Blocks</h2>
            <div style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 10px;">
                This is a simple div containing pure text content without any nested elements.
            </div>
            <div style="color: #666; font-size: 14px; line-height: 1.5; margin-bottom: 10px;">
                This is another text block with slightly different styling and color.
            </div>
            <div style="color: #999; font-size: 12px; line-height: 1.4;">
                This is a smaller text block, often used for metadata or footnotes.
            </div>
        </div>
        
        <!-- Text divs with different alignments -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Text Alignment</h2>
            <div style="text-align: left; color: #333; padding: 10px; background: #f8f9fa; border-radius: 4px; margin-bottom: 10px;">
                Left aligned text content
            </div>
            <div style="text-align: center; color: #333; padding: 10px; background: #f8f9fa; border-radius: 4px; margin-bottom: 10px;">
                Center aligned text content
            </div>
            <div style="text-align: right; color: #333; padding: 10px; background: #f8f9fa; border-radius: 4px; margin-bottom: 10px;">
                Right aligned text content
            </div>
            <div style="text-align: justify; color: #333; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                Justified text content that spans multiple lines to demonstrate how text justification works. This should distribute the text evenly across the width.
            </div>
        </div>
        
        <!-- Text divs with different weights and styles -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Font Weights and Styles</h2>
            <div style="font-weight: 300; color: #333; margin-bottom: 10px;">
                Light weight text (font-weight: 300)
            </div>
            <div style="font-weight: 400; color: #333; margin-bottom: 10px;">
                Normal weight text (font-weight: 400)
            </div>
            <div style="font-weight: 600; color: #333; margin-bottom: 10px;">
                Semi-bold weight text (font-weight: 600)
            </div>
            <div style="font-weight: 700; color: #333; margin-bottom: 10px;">
                Bold weight text (font-weight: 700)
            </div>
            <div style="font-style: italic; color: #333; margin-bottom: 10px;">
                Italic text style
            </div>
            <div style="text-decoration: underline; color: #333; margin-bottom: 10px;">
                Underlined text
            </div>
            <div style="text-decoration: line-through; color: #999;">
                Strikethrough text
            </div>
        </div>
        
        <!-- Text divs with backgrounds and borders -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Styled Text Blocks</h2>
            <div style="background: #d4edda; color: #155724; padding: 15px; border-radius: 4px; margin-bottom: 10px; border-left: 4px solid #28a745;">
                Success message: Your changes have been saved successfully.
            </div>
            <div style="background: #fff3cd; color: #856404; padding: 15px; border-radius: 4px; margin-bottom: 10px; border-left: 4px solid #ffc107;">
                Warning message: Please review your information before submitting.
            </div>
            <div style="background: #f8d7da; color: #721c24; padding: 15px; border-radius: 4px; margin-bottom: 10px; border-left: 4px solid #dc3545;">
                Error message: An error occurred while processing your request.
            </div>
            <div style="background: #d1ecf1; color: #0c5460; padding: 15px; border-radius: 4px; border-left: 4px solid #17a2b8;">
                Info message: This is some helpful information for you.
            </div>
        </div>
        
        <!-- Text divs with different line heights -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Line Height Variations</h2>
            <div style="line-height: 1.2; color: #333; margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                Tight line height (1.2): Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </div>
            <div style="line-height: 1.6; color: #333; margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                Normal line height (1.6): Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </div>
            <div style="line-height: 2.0; color: #333; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                Loose line height (2.0): Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </div>
        </div>
        
        <!-- Text divs with letter spacing -->
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Letter Spacing</h2>
            <div style="letter-spacing: -1px; color: #333; margin-bottom: 10px;">
                Tight letter spacing (-1px)
            </div>
            <div style="letter-spacing: 0px; color: #333; margin-bottom: 10px;">
                Normal letter spacing (0px)
            </div>
            <div style="letter-spacing: 2px; color: #333; margin-bottom: 10px;">
                Wide letter spacing (2px)
            </div>
            <div style="letter-spacing: 5px; color: #333; text-transform: uppercase;">
                Extra wide with uppercase (5px)
            </div>
        </div>
    </div>`
  },
  {
    name: '[Components] Text - Mixed Styles',
    description: 'Complex text scenarios with mixed inline and block elements',
    category: 'components',
    html: `<div style="width: 800px; padding: 30px; background: #f8f9fa; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 30px 0; color: #333;">Mixed Text Styles Test</h1>
        
        <!-- Article-style content -->
        <div style="background: white; padding: 30px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="font-size: 28px; font-weight: bold; color: #2c3e50; margin-bottom: 10px; line-height: 1.3;">
                The Future of Web Development: Trends to Watch
            </div>
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #ecf0f1;">
                <span style="color: #7f8c8d; font-size: 14px;">By John Doe</span>
                <span style="color: #bdc3c7;">•</span>
                <span style="color: #7f8c8d; font-size: 14px;">March 15, 2024</span>
                <span style="color: #bdc3c7;">•</span>
                <span style="color: #3498db; font-size: 14px;">5 min read</span>
            </div>
            <div style="color: #34495e; font-size: 16px; line-height: 1.8; margin-bottom: 15px;">
                Web development continues to evolve at a <span style="font-weight: bold; color: #e74c3c;">rapid pace</span>, 
                with new technologies and frameworks emerging regularly. In this article, we'll explore the 
                <span style="background: #fff3cd; padding: 2px 4px;">key trends</span> that are shaping the industry.
            </div>
            <div style="color: #34495e; font-size: 16px; line-height: 1.8; margin-bottom: 20px;">
                From <span style="font-style: italic; color: #9b59b6;">artificial intelligence</span> integration to 
                <span style="font-style: italic; color: #3498db;">progressive web apps</span>, developers need to stay 
                informed about these changes to remain competitive.
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <span style="background: #ecf0f1; color: #2c3e50; padding: 6px 12px; border-radius: 4px; font-size: 13px;">#WebDev</span>
                <span style="background: #ecf0f1; color: #2c3e50; padding: 6px 12px; border-radius: 4px; font-size: 13px;">#JavaScript</span>
                <span style="background: #ecf0f1; color: #2c3e50; padding: 6px 12px; border-radius: 4px; font-size: 13px;">#AI</span>
                <span style="background: #ecf0f1; color: #2c3e50; padding: 6px 12px; border-radius: 4px; font-size: 13px;">#Frontend</span>
            </div>
        </div>
        
        <!-- Code snippet style -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Code Documentation Style</h2>
            <div style="color: #555; margin-bottom: 10px; line-height: 1.6;">
                Use the <span style="background: #f4f4f4; color: #e74c3c; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; font-size: 14px;">htmlToFigma()</span> 
                function to convert HTML to Figma nodes. It accepts two parameters:
            </div>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 4px; border-left: 3px solid #3498db; margin-bottom: 15px;">
                <div style="font-family: 'Courier New', monospace; color: #2c3e50; font-size: 14px; line-height: 1.6;">
                    <span style="color: #9b59b6;">htmlToFigma</span>(<span style="color: #e74c3c;">element</span>, <span style="color: #e74c3c;">options</span>)
                </div>
            </div>
            <div style="color: #555; line-height: 1.6;">
                Returns a <span style="font-family: 'Courier New', monospace; color: #16a085;">Promise&lt;FigmaNode&gt;</span> 
                that resolves with the converted Figma node structure.
            </div>
        </div>
        
        <!-- Chat message style -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Chat Message Style</h2>
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <div style="display: flex; align-items: flex-start; gap: 10px;">
                    <div style="width: 40px; height: 40px; background: #3498db; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; flex-shrink: 0;">
                        JD
                    </div>
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                            <span style="font-weight: bold; color: #2c3e50;">John Doe</span>
                            <span style="font-size: 12px; color: #95a5a6;">2:30 PM</span>
                        </div>
                        <div style="background: #ecf0f1; padding: 10px 15px; border-radius: 8px; color: #2c3e50; line-height: 1.5;">
                            Hey team! I just finished the new feature. Could someone review my PR? 
                            <span style="color: #3498db; cursor: pointer;">@sarah</span>
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: flex-start; gap: 10px;">
                    <div style="width: 40px; height: 40px; background: #e74c3c; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; flex-shrink: 0;">
                        SM
                    </div>
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                            <span style="font-weight: bold; color: #2c3e50;">Sarah Miller</span>
                            <span style="font-size: 12px; color: #95a5a6;">2:32 PM</span>
                        </div>
                        <div style="background: #ecf0f1; padding: 10px 15px; border-radius: 8px; color: #2c3e50; line-height: 1.5;">
                            Sure! I'll take a look in a few minutes. 
                            <span style="display: inline-block; margin-left: 4px;">👍</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Pricing card style -->
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Pricing Card Style</h2>
            <div style="display: flex; gap: 20px;">
                <div style="flex: 1; border: 2px solid #ecf0f1; border-radius: 8px; padding: 25px; text-align: center;">
                    <div style="color: #7f8c8d; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">
                        Basic
                    </div>
                    <div style="margin-bottom: 20px;">
                        <span style="font-size: 48px; font-weight: bold; color: #2c3e50;">$9</span>
                        <span style="color: #7f8c8d; font-size: 16px;">/month</span>
                    </div>
                    <div style="color: #555; margin-bottom: 20px; line-height: 1.8;">
                        <div style="margin-bottom: 8px;">✓ 5 Projects</div>
                        <div style="margin-bottom: 8px;">✓ 10 GB Storage</div>
                        <div style="margin-bottom: 8px;">✓ Email Support</div>
                    </div>
                    <div style="background: #ecf0f1; color: #2c3e50; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">
                        Choose Plan
                    </div>
                </div>
                <div style="flex: 1; border: 2px solid #3498db; border-radius: 8px; padding: 25px; text-align: center; position: relative;">
                    <div style="position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: #3498db; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold;">
                        POPULAR
                    </div>
                    <div style="color: #3498db; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">
                        Pro
                    </div>
                    <div style="margin-bottom: 20px;">
                        <span style="font-size: 48px; font-weight: bold; color: #2c3e50;">$29</span>
                        <span style="color: #7f8c8d; font-size: 16px;">/month</span>
                    </div>
                    <div style="color: #555; margin-bottom: 20px; line-height: 1.8;">
                        <div style="margin-bottom: 8px;">✓ Unlimited Projects</div>
                        <div style="margin-bottom: 8px;">✓ 100 GB Storage</div>
                        <div style="margin-bottom: 8px;">✓ Priority Support</div>
                    </div>
                    <div style="background: #3498db; color: white; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">
                        Choose Plan
                    </div>
                </div>
            </div>
        </div>
    </div>`
  },
  {
    name: '[Advanced] Text - Overflow and Wrapping',
    description: 'Test text overflow, wrapping, and ellipsis behaviors',
    category: 'advanced',
    html: `<div style="width: 800px; padding: 30px; background: #f8f9fa; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 30px 0; color: #333;">Text Overflow and Wrapping Test</h1>
        
        <!-- Text overflow with ellipsis -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Text Overflow: Ellipsis</h2>
            <div style="width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #f8f9fa; padding: 12px; border-radius: 4px; margin-bottom: 10px;">
                This is a very long text that will be truncated with an ellipsis when it overflows the container
            </div>
            <div style="width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #f8f9fa; padding: 12px; border-radius: 4px;">
                user@verylongemailaddress.company.com
            </div>
        </div>
        
        <!-- Word break and wrap -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Word Break Behaviors</h2>
            <div style="margin-bottom: 15px;">
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">word-break: normal</div>
                <div style="width: 200px; background: #f8f9fa; padding: 12px; border-radius: 4px; word-break: normal;">
                    ThisIsAVeryLongWordWithoutAnySpacesThatShouldBreak
                </div>
            </div>
            <div style="margin-bottom: 15px;">
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">word-break: break-all</div>
                <div style="width: 200px; background: #f8f9fa; padding: 12px; border-radius: 4px; word-break: break-all;">
                    ThisIsAVeryLongWordWithoutAnySpacesThatShouldBreak
                </div>
            </div>
            <div>
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">word-break: break-word</div>
                <div style="width: 200px; background: #f8f9fa; padding: 12px; border-radius: 4px; word-break: break-word;">
                    ThisIsAVeryLongWordWithoutAnySpacesThatShouldBreak
                </div>
            </div>
        </div>
        
        <!-- White-space variations -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">White-space Properties</h2>
            <div style="margin-bottom: 15px;">
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">white-space: normal</div>
                <div style="width: 300px; background: #f8f9fa; padding: 12px; border-radius: 4px; white-space: normal;">
                    This    text    has    multiple    spaces    and
                    line breaks that will be collapsed.
                </div>
            </div>
            <div style="margin-bottom: 15px;">
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">white-space: nowrap</div>
                <div style="width: 300px; background: #f8f9fa; padding: 12px; border-radius: 4px; white-space: nowrap; overflow: auto;">
                    This text will not wrap to the next line even if it's very long and exceeds the container width
                </div>
            </div>
            <div>
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">white-space: pre-wrap</div>
                <div style="width: 300px; background: #f8f9fa; padding: 12px; border-radius: 4px; white-space: pre-wrap;">
                    This    text    preserves    spaces
                    and line breaks
                    but still wraps when needed.
                </div>
            </div>
        </div>
        
        <!-- Multi-line truncation -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Multi-line Truncation</h2>
            <div style="width: 350px; background: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                <div style="font-weight: bold; color: #2c3e50; margin-bottom: 8px;">Article Title That Might Be Long</div>
                <div style="color: #555; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
                </div>
                <div style="color: #3498db; margin-top: 8px; font-size: 14px; cursor: pointer;">Read more →</div>
            </div>
        </div>
        
        <!-- Long words in flex containers -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Long Content in Flex</h2>
            <div style="display: flex; gap: 15px; align-items: flex-start;">
                <div style="width: 60px; height: 60px; background: #3498db; border-radius: 8px; flex-shrink: 0;"></div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: bold; color: #2c3e50; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        VeryLongFileNameWithoutSpacesThatShouldBeTruncated.pdf
                    </div>
                    <div style="color: #7f8c8d; font-size: 14px;">
                        2.5 MB • Modified 2 days ago
                    </div>
                </div>
                <div style="color: #3498db; cursor: pointer; flex-shrink: 0;">Download</div>
            </div>
        </div>
        
        <!-- Text in fixed width containers -->
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Fixed Width Containers</h2>
            <div style="display: flex; gap: 15px;">
                <div style="width: 150px; background: #f8f9fa; padding: 15px; border-radius: 4px;">
                    <div style="font-weight: bold; color: #2c3e50; margin-bottom: 8px; word-wrap: break-word;">
                        SupercalifragilisticexpialidociousWord
                    </div>
                    <div style="color: #555; font-size: 14px; line-height: 1.5;">
                        This demonstrates how long words wrap in a narrow container.
                    </div>
                </div>
                <div style="width: 250px; background: #f8f9fa; padding: 15px; border-radius: 4px;">
                    <div style="font-weight: bold; color: #2c3e50; margin-bottom: 8px;">
                        URL Example
                    </div>
                    <div style="color: #3498db; font-size: 14px; word-break: break-all;">
                        https://www.example.com/very/long/url/path/that/needs/to/wrap/properly
                    </div>
                </div>
            </div>
        </div>
    </div>`
  },
  {
    name: '[Advanced] Text - Ellipsis Comprehensive',
    description: 'Comprehensive text ellipsis scenarios including single-line, multi-line, and various layouts',
    category: 'advanced',
    html: `<div style="width: 800px; padding: 30px; background: #f8f9fa; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 30px 0; color: #333;">Text Ellipsis Comprehensive Test</h1>
        
        <!-- Single-line ellipsis variations -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Single-Line Ellipsis</h2>
            
            <div style="margin-bottom: 15px;">
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">400px width - Long filename</div>
                <div style="width: 400px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #f8f9fa; padding: 12px; border-radius: 4px; color: #333;">
                    very-long-document-name-with-multiple-words-and-dashes-2024-final-version-v3.pdf
                </div>
            </div>
            
            <div style="margin-bottom: 15px;">
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">250px width - Email address</div>
                <div style="width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #f8f9fa; padding: 12px; border-radius: 4px; color: #333;">
                    john.smith.developer@verylongcompanyname.com
                </div>
            </div>
            
            <div style="margin-bottom: 15px;">
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">200px width - URL</div>
                <div style="width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #f8f9fa; padding: 12px; border-radius: 4px; color: #3498db;">
                    https://www.example.com/blog/articles/2024/march/web-development
                </div>
            </div>
            
            <div>
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">150px width - Short text</div>
                <div style="width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #f8f9fa; padding: 12px; border-radius: 4px; color: #333;">
                    This is a short text
                </div>
            </div>
        </div>
        
        <!-- Multi-line ellipsis variations -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Multi-Line Ellipsis (-webkit-line-clamp)</h2>
            
            <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                <div style="flex: 1;">
                    <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">2 lines clamp</div>
                    <div style="background: #f8f9fa; padding: 12px; border-radius: 4px;">
                        <div style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: #333; line-height: 1.6;">
                            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.
                        </div>
                    </div>
                </div>
                <div style="flex: 1;">
                    <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">3 lines clamp</div>
                    <div style="background: #f8f9fa; padding: 12px; border-radius: 4px;">
                        <div style="display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; color: #333; line-height: 1.6;">
                            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.
                        </div>
                    </div>
                </div>
            </div>
            
            <div>
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">4 lines clamp - Article preview</div>
                <div style="background: #f8f9fa; padding: 12px; border-radius: 4px;">
                    <div style="display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; color: #333; line-height: 1.8;">
                        Web development has evolved significantly over the past decade. Modern frameworks and tools have made it easier to build complex applications. However, with great power comes great responsibility. Developers need to stay updated with the latest best practices and security considerations. This article explores the current state of web development and what the future holds.
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Ellipsis in flex layouts -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Ellipsis in Flex Layouts</h2>
            
            <!-- File list item -->
            <div style="margin-bottom: 15px;">
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">File list item</div>
                <div style="display: flex; align-items: center; gap: 12px; background: #f8f9fa; padding: 12px; border-radius: 4px;">
                    <div style="width: 40px; height: 40px; background: #3498db; border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                        PDF
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 600; color: #2c3e50; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px;">
                            Annual-Report-2024-Financial-Summary-Q1-Q2-Q3-Q4-Complete.pdf
                        </div>
                        <div style="font-size: 13px; color: #7f8c8d;">
                            3.2 MB • Modified yesterday
                        </div>
                    </div>
                    <div style="color: #3498db; font-size: 14px; cursor: pointer; flex-shrink: 0;">
                        Download
                    </div>
                </div>
            </div>
            
            <!-- User list item -->
            <div style="margin-bottom: 15px;">
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">User profile item</div>
                <div style="display: flex; align-items: center; gap: 12px; background: #f8f9fa; padding: 12px; border-radius: 4px;">
                    <div style="width: 50px; height: 50px; background: #e74c3c; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 18px;">
                        JD
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 600; color: #2c3e50; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px;">
                            Jonathan David Richardson-Smith III
                        </div>
                        <div style="font-size: 13px; color: #7f8c8d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            jonathan.richardson.smith@verylongcompanydomain.com
                        </div>
                    </div>
                    <div style="background: #27ae60; color: white; padding: 6px 12px; border-radius: 4px; font-size: 13px; flex-shrink: 0;">
                        Follow
                    </div>
                </div>
            </div>
            
            <!-- Breadcrumb with ellipsis -->
            <div>
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 5px;">Breadcrumb navigation</div>
                <div style="display: flex; align-items: center; gap: 8px; background: #f8f9fa; padding: 12px; border-radius: 4px;">
                    <span style="color: #3498db; cursor: pointer; font-size: 14px;">Home</span>
                    <span style="color: #95a5a6;">›</span>
                    <span style="color: #3498db; cursor: pointer; font-size: 14px;">Documents</span>
                    <span style="color: #95a5a6;">›</span>
                    <span style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #3498db; cursor: pointer; font-size: 14px;">Very Long Folder Name With Many Words</span>
                    <span style="color: #95a5a6;">›</span>
                    <span style="color: #2c3e50; font-size: 14px;">Current File</span>
                </div>
            </div>
        </div>
        
        <!-- Card layouts with ellipsis -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Card Layouts with Ellipsis</h2>
            
            <div style="display: flex; gap: 15px;">
                <!-- Product card 1 -->
                <div style="flex: 1; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                    <div style="width: 100%; height: 120px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);"></div>
                    <div style="padding: 15px;">
                        <div style="font-size: 16px; font-weight: 600; color: #2c3e50; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            Premium Wireless Noise-Cancelling Headphones with Bluetooth 5.0
                        </div>
                        <div style="font-size: 14px; color: #7f8c8d; line-height: 1.5; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                            Experience crystal-clear audio with our advanced noise-cancelling technology. Perfect for travel, work, and everyday listening.
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 20px; font-weight: bold; color: #27ae60;">$299</span>
                            <span style="background: #3498db; color: white; padding: 8px 16px; border-radius: 4px; font-size: 14px; cursor: pointer;">Buy Now</span>
                        </div>
                    </div>
                </div>
                
                <!-- Product card 2 -->
                <div style="flex: 1; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                    <div style="width: 100%; height: 120px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);"></div>
                    <div style="padding: 15px;">
                        <div style="font-size: 16px; font-weight: 600; color: #2c3e50; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            Smart Watch Ultra Pro Max
                        </div>
                        <div style="font-size: 14px; color: #7f8c8d; line-height: 1.5; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                            Track your fitness, monitor your health, and stay connected with the latest smartwatch technology.
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 20px; font-weight: bold; color: #27ae60;">$399</span>
                            <span style="background: #3498db; color: white; padding: 8px 16px; border-radius: 4px; font-size: 14px; cursor: pointer;">Buy Now</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Table-style layout with ellipsis -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Table-Style Layout</h2>
            
            <!-- Header -->
            <div style="display: flex; padding: 10px; background: #f8f9fa; border-radius: 4px 4px 0 0; border-bottom: 2px solid #e0e0e0; font-weight: 600; color: #2c3e50; font-size: 14px;">
                <div style="flex: 2; padding: 0 8px;">Name</div>
                <div style="flex: 1; padding: 0 8px;">Type</div>
                <div style="flex: 1; padding: 0 8px;">Size</div>
                <div style="flex: 1; padding: 0 8px;">Modified</div>
            </div>
            
            <!-- Row 1 -->
            <div style="display: flex; padding: 12px 10px; border-bottom: 1px solid #f0f0f0; align-items: center;">
                <div style="flex: 2; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #333;">
                    Project-Presentation-Final-Version-2024-Q1-Marketing-Strategy.pptx
                </div>
                <div style="flex: 1; padding: 0 8px; color: #7f8c8d; font-size: 14px;">PowerPoint</div>
                <div style="flex: 1; padding: 0 8px; color: #7f8c8d; font-size: 14px;">12.5 MB</div>
                <div style="flex: 1; padding: 0 8px; color: #7f8c8d; font-size: 14px;">2 days ago</div>
            </div>
            
            <!-- Row 2 -->
            <div style="display: flex; padding: 12px 10px; border-bottom: 1px solid #f0f0f0; align-items: center;">
                <div style="flex: 2; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #333;">
                    Annual-Budget-Report-Financial-Analysis-2023-2024-Complete.xlsx
                </div>
                <div style="flex: 1; padding: 0 8px; color: #7f8c8d; font-size: 14px;">Excel</div>
                <div style="flex: 1; padding: 0 8px; color: #7f8c8d; font-size: 14px;">8.3 MB</div>
                <div style="flex: 1; padding: 0 8px; color: #7f8c8d; font-size: 14px;">1 week ago</div>
            </div>
            
            <!-- Row 3 -->
            <div style="display: flex; padding: 12px 10px; align-items: center;">
                <div style="flex: 2; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #333;">
                    Meeting-Notes-Team-Sync-Product-Development-Sprint-Planning.docx
                </div>
                <div style="flex: 1; padding: 0 8px; color: #7f8c8d; font-size: 14px;">Word</div>
                <div style="flex: 1; padding: 0 8px; color: #7f8c8d; font-size: 14px;">156 KB</div>
                <div style="flex: 1; padding: 0 8px; color: #7f8c8d; font-size: 14px;">3 hours ago</div>
            </div>
        </div>
        
        <!-- Mixed ellipsis scenarios -->
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Mixed Scenarios</h2>
            
            <!-- Notification -->
            <div style="background: #f8f9fa; padding: 15px; border-radius: 4px; border-left: 4px solid #3498db; margin-bottom: 15px;">
                <div style="display: flex; align-items: flex-start; gap: 10px;">
                    <div style="color: #3498db; font-size: 20px; flex-shrink: 0;">ℹ</div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 600; color: #2c3e50; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            System Update: New Features Available in Version 2.5.0 Beta Release
                        </div>
                        <div style="font-size: 14px; color: #555; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                            We've added several new features including improved performance, better UI components, and enhanced security. Click here to learn more about what's new.
                        </div>
                    </div>
                    <button style="background: #3498db; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; flex-shrink: 0;">
                        View
                    </button>
                </div>
            </div>
            
            <!-- Comment -->
            <div style="background: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                <div style="display: flex; gap: 10px;">
                    <div style="width: 36px; height: 36px; background: #9b59b6; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">
                        AS
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                            <span style="font-weight: 600; color: #2c3e50; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Alexandra Smith-Johnson</span>
                            <span style="color: #95a5a6; font-size: 12px; flex-shrink: 0;">2h ago</span>
                        </div>
                        <div style="color: #555; font-size: 14px; line-height: 1.6;">
                            Great work on the latest update! I really appreciate the new features and improvements you've made to the dashboard.
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Tag list with ellipsis -->
            <div>
                <div style="color: #7f8c8d; font-size: 13px; margin-bottom: 8px;">Tags (with ellipsis on individual tags)</div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    <span style="max-width: 150px; background: #e3f2fd; color: #1976d2; padding: 6px 12px; border-radius: 4px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block;">
                        javascript-frameworks-and-libraries
                    </span>
                    <span style="max-width: 150px; background: #f3e5f5; color: #7b1fa2; padding: 6px 12px; border-radius: 4px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block;">
                        web-development-best-practices
                    </span>
                    <span style="max-width: 150px; background: #e8f5e9; color: #2e7d32; padding: 6px 12px; border-radius: 4px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block;">
                        performance-optimization-tips
                    </span>
                    <span style="max-width: 150px; background: #fff3e0; color: #ef6c00; padding: 6px 12px; border-radius: 4px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block;">
                        ui-ux-design-principles
                    </span>
                </div>
            </div>
        </div>
    </div>`
  }
,
  {
    name: '[Layout] Float Layout Test',
    description: 'Test CSS float properties - parent should use manual layout (NONE) with calculated child positions',
    category: 'layout',
    html: `<div style="width: 800px; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 20px 0; color: #333;">Float Layout Test</h1>
        <p style="margin: 0 0 20px 0; color: #666;">Testing float elements - parent containers should use layoutMode: NONE</p>
        
        <!-- Test 1: Basic Left and Right Float -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Test 1: Basic Float (Left & Right)</h2>
            <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">Expected: Parent uses manual layout, child positions calculated by browser</p>
            
            <div class="float-container" style="border: 2px dashed #ccc; padding: 15px; min-height: 150px;">
                <div style="float: left; width: 200px; height: 100px; background: #4CAF50; color: white; padding: 15px; margin-right: 15px; border-radius: 4px;">
                    <strong>Left Float</strong><br/>
                    float: left<br/>
                    width: 200px
                </div>
                <div style="float: right; width: 200px; height: 100px; background: #2196F3; color: white; padding: 15px; margin-left: 15px; border-radius: 4px;">
                    <strong>Right Float</strong><br/>
                    float: right<br/>
                    width: 200px
                </div>
                <div style="clear: both; padding-top: 10px; color: #666;">
                    This text appears below floats (clear: both)
                </div>
            </div>
        </div>
        
        <!-- Test 2: Multiple Left Floats -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Test 2: Multiple Float Elements</h2>
            <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">Multiple float: left elements should wrap horizontally</p>
            
            <div class="float-container" style="border: 2px dashed #ccc; padding: 15px; min-height: 200px;">
                <div style="float: left; width: 150px; height: 120px; background: #FF9800; color: white; padding: 15px; margin: 10px; border-radius: 4px; text-align: center;">
                    <strong>Item 1</strong><br/>
                    float: left
                </div>
                <div style="float: left; width: 150px; height: 120px; background: #FF9800; color: white; padding: 15px; margin: 10px; border-radius: 4px; text-align: center;">
                    <strong>Item 2</strong><br/>
                    float: left
                </div>
                <div style="float: left; width: 150px; height: 120px; background: #FF9800; color: white; padding: 15px; margin: 10px; border-radius: 4px; text-align: center;">
                    <strong>Item 3</strong><br/>
                    float: left
                </div>
                <div style="float: left; width: 150px; height: 120px; background: #FF9800; color: white; padding: 15px; margin: 10px; border-radius: 4px; text-align: center;">
                    <strong>Item 4</strong><br/>
                    float: left
                </div>
                <div style="clear: both;"></div>
            </div>
        </div>
        
        <!-- Test 3: Float with Text Wrapping -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Test 3: Float Image with Text Wrapping</h2>
            <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">Classic float layout: image floats left, text wraps around</p>
            
            <div class="float-container" style="border: 2px dashed #ccc; padding: 15px;">
                <div style="float: left; width: 200px; height: 150px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin-right: 20px; margin-bottom: 15px; border-radius: 8px;"></div>
                <p style="margin: 0 0 10px 0; color: #333; line-height: 1.6;">
                    This is a paragraph of text that wraps around the floated element. The float property allows 
                    the text to flow naturally around the floated box, which is a common layout pattern in web design.
                </p>
                <p style="margin: 0; color: #333; line-height: 1.6;">
                    When an element is floated, it is taken out of the normal document flow, but unlike 
                    absolutely positioned elements, it still affects the positioning of surrounding content. 
                    This is particularly useful for magazine-style layouts with images and text.
                </p>
                <div style="clear: both;"></div>
            </div>
        </div>
        
        <!-- Test 4: Nested Float -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Test 4: Nested Containers with Float</h2>
            <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">Outer container has float children, should use manual layout</p>
            
            <div class="outer-float-container" style="border: 2px solid #9C27B0; padding: 15px; background: #f3e5f5;">
                <h3 style="margin: 0 0 10px 0; color: #9C27B0; font-size: 16px;">Outer Container</h3>
                <div style="float: left; width: 350px; background: white; padding: 15px; margin-right: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h4 style="margin: 0 0 10px 0; color: #333;">Left Panel</h4>
                    <p style="margin: 0; color: #666; font-size: 14px;">This panel floats left. The outer container should use manual layout because it has float children.</p>
                </div>
                <div style="float: right; width: 350px; background: white; padding: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h4 style="margin: 0 0 10px 0; color: #333;">Right Panel</h4>
                    <p style="margin: 0; color: #666; font-size: 14px;">This panel floats right. Both panels are children of the outer float container.</p>
                </div>
                <div style="clear: both; padding-top: 15px;">
                    <div style="background: #e1bee7; padding: 10px; border-radius: 4px;">
                        <strong>Note:</strong> This content appears after the floats are cleared.
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Test 5: Float vs Flex (Control Test) -->
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Test 5: Control - Flex Container (No Float)</h2>
            <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">This uses flexbox, should use auto layout (not manual)</p>
            
            <div style="display: flex; gap: 15px; padding: 15px; border: 2px solid #00BCD4; border-radius: 4px; background: #e0f7fa;">
                <div style="flex: 1; background: white; padding: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <strong>Flex Item 1</strong><br/>
                    (No float property)
                </div>
                <div style="flex: 1; background: white; padding: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <strong>Flex Item 2</strong><br/>
                    (No float property)
                </div>
                <div style="flex: 1; background: white; padding: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <strong>Flex Item 3</strong><br/>
                    (No float property)
                </div>
            </div>
            <p style="margin: 15px 0 0 0; color: #666; font-size: 14px;">
                ✅ Flex containers should use HORIZONTAL or VERTICAL layoutMode
            </p>
        </div>
        
        <!-- Summary -->
        <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-top: 20px; border-left: 4px solid #ffc107;">
            <h3 style="margin: 0 0 10px 0; color: #856404;">Expected Behavior</h3>
            <ul style="margin: 0; padding-left: 20px; color: #856404; line-height: 1.8;">
                <li>Containers with float children → <strong>layoutMode: NONE</strong></li>
                <li>Flex/Grid containers → <strong>layoutMode: HORIZONTAL/VERTICAL</strong></li>
                <li>Float elements use browser-calculated positions (from boundingRect)</li>
                <li>Float in flex containers is ignored (flex takes precedence)</li>
            </ul>
        </div>
    </div>`
  },
  {
    name: '[Advanced] Background Image Test',
    description: 'Test various background-image CSS properties including images, gradients, and combinations',
    category: 'advanced',
    html: `<div style="width: 1000px; padding: 30px; background: #f5f5f5; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 20px 0; color: #333;">Background Image Test</h1>
        <p style="margin: 0 0 30px 0; color: #666;">Comprehensive test for background-image CSS properties including images, gradients, and various positioning options.</p>
        
        <!-- Basic Background Image with Cover -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333;">Background Image - Cover</h2>
            <div style="
                width: 300px; 
                height: 200px; 
                background-image: url('https://picsum.photos/600/400?random=1');
                background-size: cover;
                background-position: center;
                background-repeat: no-repeat;
                border-radius: 8px;
                border: 2px solid #ddd;
            "></div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">background-size: cover; background-position: center;</p>
        </div>
        
        <!-- Background Image with Contain -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333;">Background Image - Contain</h2>
            <div style="
                width: 300px; 
                height: 200px; 
                background-image: url('https://picsum.photos/400/300?random=2');
                background-size: contain;
                background-position: center;
                background-repeat: no-repeat;
                background-color: #f0f0f0;
                border-radius: 8px;
                border: 2px solid #ddd;
            "></div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">background-size: contain; background-position: center;</p>
        </div>
        
        <!-- Background Image with Different Positions -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333;">Background Position Variations</h2>
            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                <div>
                    <div style="
                        width: 150px; 
                        height: 150px; 
                        background-image: url('https://picsum.photos/300/300?random=3');
                        background-size: 80px 80px;
                        background-position: top left;
                        background-repeat: no-repeat;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">top left</p>
                </div>
                <div>
                    <div style="
                        width: 150px; 
                        height: 150px; 
                        background-image: url('https://picsum.photos/300/300?random=4');
                        background-size: 80px 80px;
                        background-position: top right;
                        background-repeat: no-repeat;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">top right</p>
                </div>
                <div>
                    <div style="
                        width: 150px; 
                        height: 150px; 
                        background-image: url('https://picsum.photos/300/300?random=5');
                        background-size: 80px 80px;
                        background-position: bottom center;
                        background-repeat: no-repeat;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">bottom center</p>
                </div>
                <div>
                    <div style="
                        width: 150px; 
                        height: 150px; 
                        background-image: url('https://picsum.photos/300/300?random=6');
                        background-size: 80px 80px;
                        background-position: 20px 30px;
                        background-repeat: no-repeat;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">20px 30px</p>
                </div>
            </div>
        </div>
        
        <!-- Background Repeat Variations -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333;">Background Repeat Variations</h2>
            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                <div>
                    <div style="
                        width: 200px; 
                        height: 150px; 
                        background-image: url('https://picsum.photos/50/50?random=7');
                        background-size: 50px 50px;
                        background-repeat: repeat;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">repeat</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 150px; 
                        background-image: url('https://picsum.photos/50/50?random=8');
                        background-size: 50px 50px;
                        background-repeat: repeat-x;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">repeat-x</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 150px; 
                        background-image: url('https://picsum.photos/50/50?random=9');
                        background-size: 50px 50px;
                        background-repeat: repeat-y;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">repeat-y</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 150px; 
                        background-image: url('https://picsum.photos/50/50?random=10');
                        background-size: 50px 50px;
                        background-repeat: no-repeat;
                        background-position: center;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">no-repeat</p>
                </div>
            </div>
        </div>
        
        <!-- Linear Gradients -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333;">Linear Gradients</h2>
            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                <div>
                    <div style="
                        width: 200px; 
                        height: 120px; 
                        background-image: linear-gradient(to right, #ff6b6b, #4ecdc4);
                        border-radius: 8px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">left to right</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 120px; 
                        background-image: linear-gradient(to bottom, #667eea, #764ba2);
                        border-radius: 8px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">top to bottom</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 120px; 
                        background-image: linear-gradient(45deg, #f093fb, #f5576c);
                        border-radius: 8px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">45deg diagonal</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 120px; 
                        background-image: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
                        border-radius: 8px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">multi-stop gradient</p>
                </div>
            </div>
        </div>
        
        <!-- Radial Gradients -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333;">Radial Gradients</h2>
            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                <div>
                    <div style="
                        width: 200px; 
                        height: 200px; 
                        background-image: radial-gradient(circle, #ff6b6b, #4ecdc4);
                        border-radius: 8px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">circle gradient</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 200px; 
                        background-image: radial-gradient(ellipse, #667eea, #764ba2);
                        border-radius: 8px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">ellipse gradient</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 200px; 
                        background-image: radial-gradient(circle at top left, #f093fb, #f5576c);
                        border-radius: 8px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">positioned circle</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 200px; 
                        background-image: radial-gradient(circle, #667eea 0%, #764ba2 50%, #f093fb 100%);
                        border-radius: 8px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">multi-stop radial</p>
                </div>
            </div>
        </div>
        
        <!-- Multiple Background Images -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333;">Multiple Background Images</h2>
            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                <div>
                    <div style="
                        width: 300px; 
                        height: 200px; 
                        background-image: 
                            linear-gradient(45deg, rgba(255,107,107,0.5), rgba(78,205,196,0.5)),
                            url('https://picsum.photos/600/400?random=11');
                        background-size: cover;
                        background-position: center;
                        border-radius: 8px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">gradient overlay + image</p>
                </div>
                <div>
                    <div style="
                        width: 300px; 
                        height: 200px; 
                        background-image: 
                            url('https://picsum.photos/100/100?random=12'),
                            url('https://picsum.photos/600/400?random=13');
                        background-size: 100px 100px, cover;
                        background-position: top 10px right 10px, center;
                        background-repeat: no-repeat, no-repeat;
                        border-radius: 8px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">multiple images layered</p>
                </div>
            </div>
        </div>
        
        <!-- Background with Content -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333;">Background with Content</h2>
            <div style="
                width: 600px; 
                height: 300px; 
                background-image: 
                    linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)),
                    url('https://picsum.photos/1200/600?random=14');
                background-size: cover;
                background-position: center;
                background-repeat: no-repeat;
                border-radius: 8px;
                border: 2px solid #ddd;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                color: white;
                padding: 30px;
            ">
                <h3 style="margin: 0 0 10px 0; font-size: 32px; text-align: center;">Hero Section</h3>
                <p style="margin: 0; font-size: 18px; text-align: center; opacity: 0.9;">Beautiful background image with overlay and centered content</p>
            </div>
        </div>
        
        <!-- Background Size Variations -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333;">Background Size Variations</h2>
            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                <div>
                    <div style="
                        width: 180px; 
                        height: 120px; 
                        background-image: url('https://picsum.photos/300/200?random=15');
                        background-size: auto;
                        background-position: center;
                        background-repeat: no-repeat;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">auto (original size)</p>
                </div>
                <div>
                    <div style="
                        width: 180px; 
                        height: 120px; 
                        background-image: url('https://picsum.photos/300/200?random=16');
                        background-size: 100px 80px;
                        background-position: center;
                        background-repeat: no-repeat;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">100px 80px</p>
                </div>
                <div>
                    <div style="
                        width: 180px; 
                        height: 120px; 
                        background-image: url('https://picsum.photos/300/200?random=17');
                        background-size: 100% 100%;
                        background-position: center;
                        background-repeat: no-repeat;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">100% 100% (stretch)</p>
                </div>
                <div>
                    <div style="
                        width: 180px; 
                        height: 120px; 
                        background-image: url('https://picsum.photos/300/200?random=18');
                        background-size: 50% auto;
                        background-position: center;
                        background-repeat: no-repeat;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                        border: 2px solid #ddd;
                    "></div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">50% auto</p>
                </div>
            </div>
        </div>
        
        <!-- Background Clip Variations -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="margin: 0 0 15px 0; color: #333;">Background Clip Variations</h2>
            <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">Background-clip controls how far the background extends within an element's box model.</p>
            <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px;">
                <div>
                    <div style="
                        width: 200px; 
                        height: 140px; 
                        background-image: linear-gradient(135deg, #667eea, #764ba2);
                        background-clip: border-box;
                        border: 10px dashed rgba(255,255,255,0.5);
                        padding: 20px;
                        box-sizing: border-box;
                    ">
                        <div style="background: rgba(255,255,255,0.9); padding: 5px; border-radius: 4px; font-size: 12px; text-align: center;">Content</div>
                    </div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;"><strong>border-box</strong> (default)</p>
                    <p style="margin: 2px 0 0 0; font-size: 11px; color: #999;">Background extends to border edge</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 140px; 
                        background-image: linear-gradient(135deg, #667eea, #764ba2);
                        background-clip: padding-box;
                        border: 10px dashed #333;
                        padding: 20px;
                        box-sizing: border-box;
                    ">
                        <div style="background: rgba(255,255,255,0.9); padding: 5px; border-radius: 4px; font-size: 12px; text-align: center;">Content</div>
                    </div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;"><strong>padding-box</strong></p>
                    <p style="margin: 2px 0 0 0; font-size: 11px; color: #999;">Background stops at border, no background under border</p>
                </div>
                <div>
                    <div style="
                        width: 200px; 
                        height: 140px; 
                        background-image: linear-gradient(135deg, #667eea, #764ba2);
                        background-clip: content-box;
                        border: 10px dashed #333;
                        padding: 20px;
                        box-sizing: border-box;
                        background-color: #f0f0f0;
                    ">
                        <div style="background: rgba(255,255,255,0.9); padding: 5px; border-radius: 4px; font-size: 12px; text-align: center;">Content</div>
                    </div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;"><strong>content-box</strong></p>
                    <p style="margin: 2px 0 0 0; font-size: 11px; color: #999;">Background only in content area</p>
                </div>
            </div>
            
            <!-- Background Clip: Text Examples -->
            <div style="margin-top: 30px;">
                <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Background Clip: Text Effect</h3>
                <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">Using background-clip: text to create gradient text effects (requires -webkit-background-clip and color: transparent).</p>
                <div style="display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start;">
                    <div>
                        <div style="
                            background-image: linear-gradient(45deg, #ff6b6b, #4ecdc4);
                            -webkit-background-clip: text;
                            background-clip: text;
                            color: transparent;
                            font-size: 48px;
                            font-weight: bold;
                            padding: 10px;
                            display: inline-block;
                        ">GRADIENT</div>
                        <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Linear gradient text</p>
                    </div>
                    <div>
                        <div style="
                            background-image: radial-gradient(circle, #f093fb, #f5576c);
                            -webkit-background-clip: text;
                            background-clip: text;
                            color: transparent;
                            font-size: 48px;
                            font-weight: bold;
                            padding: 10px;
                            display: inline-block;
                        ">RADIAL</div>
                        <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Radial gradient text</p>
                    </div>
                    <div>
                        <div style="
                            background-image: linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #f5576c 75%, #4ecdc4 100%);
                            -webkit-background-clip: text;
                            background-clip: text;
                            color: transparent;
                            font-size: 48px;
                            font-weight: bold;
                            padding: 10px;
                            display: inline-block;
                        ">RAINBOW</div>
                        <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Multi-color gradient</p>
                    </div>
                </div>
                
                <!-- Text with pattern background -->
                <div style="margin-top: 20px;">
                    <div style="
                        background-image: url('https://picsum.photos/400/200?random=19');
                        background-size: cover;
                        background-position: center;
                        -webkit-background-clip: text;
                        background-clip: text;
                        color: transparent;
                        font-size: 56px;
                        font-weight: bold;
                        padding: 10px;
                        display: inline-block;
                        letter-spacing: 2px;
                    ">IMAGE TEXT</div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Image clipped to text</p>
                </div>
            </div>
        </div>
        
        <!-- Summary -->
        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196f3;">
            <h3 style="margin: 0 0 10px 0; color: #1976d2;">Background Image Features Tested</h3>
            <ul style="margin: 0; padding-left: 20px; color: #1565c0; line-height: 1.8;">
                <li><strong>background-size:</strong> cover, contain, auto, specific dimensions, percentages</li>
                <li><strong>background-position:</strong> keywords (center, top left, etc.), pixel values</li>
                <li><strong>background-repeat:</strong> repeat, repeat-x, repeat-y, no-repeat</li>
                <li><strong>background-clip:</strong> border-box, padding-box, content-box, text (with gradient text effects)</li>
                <li><strong>Linear gradients:</strong> various directions and color stops</li>
                <li><strong>Radial gradients:</strong> circle, ellipse, positioned</li>
                <li><strong>Multiple backgrounds:</strong> layered images and gradients</li>
                <li><strong>Content over backgrounds:</strong> text and elements on background images</li>
            </ul>
        </div>
    </div>`
  },
  {
    name: '[Advanced] Background Clip Text - Mixed Text Test',
    description: 'Test background-clip: text with mixed normal and gradient text',
    category: 'advanced',
    html: `<div style="width: 1200px; padding: 40px; background: #f5f5f5; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 20px 0; color: #333; font-size: 32px;">Background Clip: Text - 混合文本测试</h1>
        <p style="margin: 0 0 30px 0; color: #666;">测试普通文本和渐变文本混合的场景</p>

        <!-- 测试用例 1: 简单混合 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 1: 简单文本混合（inline 元素）</h3>
            <p style="font-size: 24px; color: #333;">
                这是普通文本 
                <span style="
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                ">这是渐变文本</span> 
                这又是普通文本
            </p>
        </div>

        <!-- 测试用例 2: 大标题场景 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 2: 大标题场景（72px）</h3>
            <div style="
                font-size: 72px;
                font-weight: bold;
                text-align: center;
                line-height: 1;
                color: #333;
            ">
                The Intelligence That Can 
                <span style="
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                ">Discover</span>
            </div>
        </div>

        <!-- 测试用例 2b: 带宽度限制的大标题（span 元素换行） -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 2b: 限制宽度，span 元素换行 ⭐</h3>
            <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">
                重点测试：span 元素因为容器宽度限制换到下一行，应该被分到不同的 inline 包装器
            </p>
            <div style="
                width: 50%;
                font-size: 72px;
                font-weight: bold;
                text-align: center;
                line-height: 1;
                color: #333;
            ">
                The Intelligence That Can 
                <span style="
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                ">Discover</span>
            </div>
        </div>

        <!-- 测试用例 3: 多个不同渐变混合 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 3: 多个不同渐变混合</h3>
            <p style="font-size: 32px; color: #333;">
                普通文本 
                <span style="
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                ">青色渐变</span> 
                中间文本 
                <span style="
                    background: linear-gradient(45deg, #ff6b6b, #ee5a6f);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                ">红色渐变</span> 
                结尾
            </p>
        </div>

        <!-- 测试用例 4: inline-block 渐变 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 4: inline-block 元素渐变</h3>
            <div style="font-size: 36px; text-align: center;">
                <div style="
                    display: inline-block;
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                    padding: 10px;
                ">GRADIENT</div>
                <span style="color: #333; font-weight: bold; padding: 10px;">NORMAL</span>
            </div>
        </div>

        <!-- 测试用例 5: 嵌套场景 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 5: 嵌套渐变文本</h3>
            <div style="font-size: 28px; color: #333;">
                <span>外层文本 
                    <span style="
                        background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
                        background-clip: text;
                        -webkit-background-clip: text;
                        color: transparent;
                        font-weight: bold;
                    ">嵌套渐变</span> 
                    外层继续
                </span>
            </div>
        </div>

        <!-- 测试用例 6: 渐变文本换行场景 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 6: 渐变文本换行（重要！）</h3>
            
            <!-- 6a: 固定宽度容器，渐变文本自动换行 -->
            <div style="margin-bottom: 20px;">
                <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">6a: 渐变文本在固定宽度容器内自动换行</p>
                <div style="width: 300px; border: 2px dashed #ccc; padding: 10px; font-size: 24px;">
                    <span style="
                        background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                        background-clip: text;
                        -webkit-background-clip: text;
                        color: transparent;
                        font-weight: bold;
                    ">这是一段很长的渐变文本内容，它会因为容器宽度限制而自动换行显示</span>
                </div>
            </div>

            <!-- 6b: 混合文本，只有部分是渐变，整体换行 -->
            <div style="margin-bottom: 20px;">
                <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">6b: 普通文本和渐变文本混合，整体换行</p>
                <div style="width: 400px; border: 2px dashed #ccc; padding: 10px; font-size: 20px; color: #333;">
                    这是一段普通文本，
                    <span style="
                        background: linear-gradient(45deg, #ff6b6b, #ee5a6f);
                        background-clip: text;
                        -webkit-background-clip: text;
                        color: transparent;
                        font-weight: bold;
                    ">这是渐变文本部分会随着整体内容换行</span>
                    ，后面还有更多普通文本继续显示
                </div>
            </div>

            <!-- 6c: 多行渐变文本 -->
            <div>
                <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">6c: 大字号渐变文本换行</p>
                <div style="width: 350px; border: 2px dashed #ccc; padding: 10px;">
                    <span style="
                        font-size: 36px;
                        font-weight: bold;
                        background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
                        background-clip: text;
                        -webkit-background-clip: text;
                        color: transparent;
                    ">LONG GRADIENT TEXT THAT WRAPS</span>
                </div>
            </div>
        </div>

        <!-- 测试用例 7: 纯渐变（无混合） -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 7: 纯渐变文本（无混合）</h3>
            <div style="text-align: center;">
                <div style="
                    font-size: 48px;
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                    display: inline-block;
                    padding: 10px;
                ">GRADIENT ONLY</div>
            </div>
        </div>

        <!-- 测试用例 8: 多行混合 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 8: 多行文本混合</h3>
            <div style="font-size: 24px; width: 400px; border: 1px dashed #ccc; padding: 10px; color: #333;">
                这是第一行普通文本 
                <span style="
                    background: linear-gradient(135deg, #00D9C8 0%, #00E5A0 100%);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                ">渐变文本可能会换行</span> 
                继续普通文本
            </div>
        </div>

        <!-- 测试用例 9: 径向渐变 -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 9: 径向渐变文本</h3>
            <div style="font-size: 40px; text-align: center;">
                普通文本前 
                <span style="
                    background: radial-gradient(circle, #f093fb, #f5576c);
                    background-clip: text;
                    -webkit-background-clip: text;
                    color: transparent;
                    font-weight: bold;
                ">RADIAL</span> 
                普通文本后
            </div>
        </div>

        <!-- 预期结果说明 -->
        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196f3; margin-top: 30px;">
            <h3 style="margin: 0 0 10px 0; color: #1976d2;">✅ 预期转换结果</h3>
            <ul style="margin: 0; padding-left: 20px; color: #1565c0; line-height: 1.8;">
                <li><strong>普通文本</strong>：使用 color 属性的颜色，纯色 SOLID fill</li>
                <li><strong>渐变文本（带 background-clip: text）</strong>：使用渐变 GRADIENT_LINEAR/RADIAL fill</li>
                <li><strong>每个文本节点独立</strong>：只检查自己的直接父元素是否有 background-clip: text</li>
                <li><strong>不会相互影响</strong>：同一容器内的不同文本节点应该各自独立</li>
                <li><strong>外层容器无背景</strong>：有 background-clip: text 的元素本身不应该有渐变背景</li>
                <li><strong>换行处理</strong>：span 元素换行时应该被正确分到不同的 inline 包装器</li>
            </ul>
        </div>

        <!-- 错误行为示例 -->
        <div style="background: #ffebee; padding: 20px; border-radius: 8px; border-left: 4px solid #f44336; margin-top: 20px;">
            <h3 style="margin: 0 0 10px 0; color: #c62828;">❌ 常见错误</h3>
            <ul style="margin: 0; padding-left: 20px; color: #b71c1c; line-height: 1.8;">
                <li><strong>错误 1</strong>：所有文本都应用了渐变（应该只有 SPAN 内的文本有渐变）</li>
                <li><strong>错误 2</strong>：渐变文本变成了纯色或透明（没有正确提取渐变）</li>
                <li><strong>错误 3</strong>：外层容器也有渐变背景（应该被阻止）</li>
                <li><strong>错误 4</strong>：换行的 span 元素被包装在同一个 inline wrapper 中（应该分开）</li>
            </ul>
        </div>
    </div>`
  },
  {
    name: '[Advanced] Multi-Fills Background (Gradient + Image)',
    description: 'Test multi-layer backgrounds with gradients and images',
    category: 'advanced',
    html: `<div style="width: 800px; padding: 40px; background: #f5f5f5; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 20px 0; color: #333; font-size: 32px;">Multi-Fills Background Test - 多层背景测试</h1>
        <p style="margin: 0 0 30px 0; color: #666;">测试多层背景（渐变 + 图片）的转换效果</p>

        <!-- Test Case 1: Gradient + Image (User's Example) -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 1: 渐变 + 图片</h3>
            <div style="
                width: 300px; 
                height: 200px; 
                background-image: 
                    linear-gradient(45deg, rgba(255,107,107,0.5), rgba(78,205,196,0.5)),
                    url('https://picsum.photos/600/400?random=11');
                background-size: cover;
                background-position: center;
                border-radius: 8px;
                border: 2px solid #ddd;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                text-shadow: 0 1px 2px rgba(0,0,0,0.5);
            ">Gradient + Image</div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期：2 个 fills（渐变在上，图片在下）</p>
        </div>

        <!-- Test Case 2: Single Gradient (Control) -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 2: 单一渐变（对照组）</h3>
            <div style="
                width: 300px;
                height: 200px;
                background-image: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                text-shadow: 0 1px 2px rgba(0,0,0,0.5);
            ">Gradient Only</div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期：1 个 fill（渐变）</p>
        </div>

        <!-- Test Case 3: Triple Layer (2 Gradients + Image) -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 3: 三层背景（2渐变 + 图片）</h3>
            <div style="
                width: 300px;
                height: 200px;
                background-image: 
                    linear-gradient(45deg, rgba(255,0,0,0.3), transparent),
                    linear-gradient(135deg, rgba(0,255,0,0.3), transparent),
                    url('https://picsum.photos/600/400?random=22');
                background-size: cover;
                background-position: center;
                border-radius: 8px;
                border: 2px solid #ddd;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                text-shadow: 0 1px 2px rgba(0,0,0,0.5);
            ">Triple Layer</div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期：3 个 fills（渐变1、渐变2、图片）</p>
        </div>

        <!-- Test Case 4: Image Only (Control) -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 4: 单一图片（对照组）</h3>
            <div style="
                width: 300px;
                height: 200px;
                background-image: url('https://picsum.photos/600/400?random=33');
                background-size: cover;
                background-position: center;
                border-radius: 8px;
                border: 2px solid #ddd;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                text-shadow: 0 1px 2px rgba(0,0,0,0.5);
            ">Image Only</div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期：1 个 fill（图片）</p>
        </div>

        <!-- Test Case 5: Solid Color + Gradient -->
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">测试 5: 纯色 + 渐变</h3>
            <div style="
                width: 300px;
                height: 200px;
                background-image: 
                    linear-gradient(135deg, rgba(255,255,255,0.5), transparent),
                    linear-gradient(45deg, #ff6b6b, #4ecdc4);
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                text-shadow: 0 1px 2px rgba(0,0,0,0.5);
            ">Multi Gradient</div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">✅ 预期：2 个 fills（2个渐变）</p>
        </div>

        <!-- Expected Results -->
        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196f3; margin-top: 30px;">
            <h3 style="margin: 0 0 10px 0; color: #1976d2;">✅ 预期转换结果</h3>
            <ul style="margin: 0; padding-left: 20px; color: #1565c0; line-height: 1.8;">
                <li><strong>多层背景解析</strong>：正确分割 background-image 中用逗号分隔的多层</li>
                <li><strong>Fills 顺序</strong>：CSS 中第一层对应 Figma fills[0]（最上层）</li>
                <li><strong>渐变支持</strong>：linear-gradient 和 radial-gradient 都应正确转换</li>
                <li><strong>图片异步加载</strong>：图片应该异步加载并正确插入到 fills 数组</li>
                <li><strong>混合类型</strong>：可以混合渐变、图片、纯色等不同类型的 fills</li>
            </ul>
        </div>

        <!-- Common Errors -->
        <div style="background: #ffebee; padding: 20px; border-radius: 8px; border-left: 4px solid #f44336; margin-top: 20px;">
            <h3 style="margin: 0 0 10px 0; color: #c62828;">❌ 常见错误</h3>
            <ul style="margin: 0; padding-left: 20px; color: #b71c1c; line-height: 1.8;">
                <li><strong>错误 1</strong>：只转换了第一层背景，忽略了其他层</li>
                <li><strong>错误 2</strong>：图片和渐变没有正确合并到一个 fills 数组</li>
                <li><strong>错误 3</strong>：fills 顺序错误（上下层颠倒）</li>
                <li><strong>错误 4</strong>：渐变函数中的逗号被错误地当作层分隔符</li>
            </ul>
        </div>
    </div>`
  },
  {
    name: '[Advanced] Rich Text Merge Edge Cases',
    description: 'Test rich text merging: gaps, centering, multi-line, line-height, inline-block layout',
    category: 'advanced',
    html: `<div style="width: 700px; padding: 20px; background: #f8f9fa; font-family: Arial, sans-serif;">
        <h1 style="margin: 0 0 20px 0; color: #333;">Rich Text Merge 测试</h1>

        <!-- Case 1: Single-line partial merge (flex-row) -->
        <div style="background: white; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
            <h3 style="margin: 0 0 10px 0; color: #555; font-size: 14px;">Case 1: 单行 partial merge (flex-row)</h3>
            <p style="margin: 0; line-height: 1.8;">
                This is <span style="font-weight: bold; color: #e74c3c;">red bold text</span> and
                <span style="font-style: italic; color: #3498db;">blue italic text</span> and
                <span style="background: #f1c40f; padding: 2px 6px; border-radius: 3px;">highlighted text</span>
                in the same paragraph.
            </p>
        </div>

        <!-- Case 2: Multi-line partial merge (absolute positioning) -->
        <div style="background: white; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
            <h3 style="margin: 0 0 10px 0; color: #555; font-size: 14px;">Case 2: 多行 partial merge (absolute)</h3>
            <p style="margin: 0; line-height: 1.8;">
                Web development continues to evolve at a
                <span style="font-weight: bold; color: #e74c3c;">rapid pace</span>, with new technologies and frameworks
                emerging regularly. In this article, we'll explore the
                <span style="background: #fff3cd; padding: 2px 6px; border-radius: 3px;">key trends</span>
                that are shaping the industry.
            </p>
        </div>

        <!-- Case 3: Full merge with gaps (margin between spans) -->
        <div style="background: white; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
            <h3 style="margin: 0 0 10px 0; color: #555; font-size: 14px;">Case 3: 带间距的 full merge (gap-wrapper)</h3>
            <div style="margin: 0;">
                <span style="font-size: 12px; color: #7f8c8d; margin-right: 15px;">Small</span>
                <span style="font-size: 16px; color: #34495e; margin-right: 15px;">Medium</span>
                <span style="font-size: 24px; font-weight: bold; color: #2c3e50; margin-right: 15px;">Large</span>
                <span style="font-size: 32px; color: #e74c3c;">Extra Large</span>
            </div>
        </div>

        <!-- Case 4: text-align center preservation -->
        <div style="background: white; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
            <h3 style="margin: 0 0 10px 0; color: #555; font-size: 14px;">Case 4: text-align center 居中保留</h3>
            <div style="text-align: center; margin: 0;">
                <span style="font-size: 48px; font-weight: bold; color: #2c3e50;">$29</span>
                <span style="font-size: 16px; color: #7f8c8d; margin-left: 4px;">/month</span>
            </div>
            <div style="text-align: center; margin-top: 10px;">
                <span style="font-size: 20px; font-weight: bold; color: #e74c3c; margin-right: 8px;">$99.99</span>
                <span style="font-size: 12px; color: #7f8c8d; text-decoration: line-through;">$149.99</span>
            </div>
        </div>

        <!-- Case 5: Line-height vs font-metric height -->
        <div style="background: white; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
            <h3 style="margin: 0 0 10px 0; color: #555; font-size: 14px;">Case 5: line-height 高度补偿</h3>
            <p style="margin: 0; line-height: 2;">
                Price: <span style="font-size: 20px; font-weight: bold; color: #e74c3c;">$99.99</span>
                <span style="font-size: 12px; color: #7f8c8d; text-decoration: line-through; margin-left: 8px;">$149.99</span>
                <span style="background: #27ae60; color: white; padding: 2px 8px; border-radius: 3px; margin-left: 8px; font-size: 12px; font-weight: bold;">SAVE 33%</span>
            </p>
        </div>

        <!-- Case 6: Inline-block elements in block container -->
        <div style="background: white; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
            <h3 style="margin: 0 0 10px 0; color: #555; font-size: 14px;">Case 6: inline-block 按钮排列</h3>
            <div style="margin: 0;">
                <span style="border: 2px solid #e74c3c; color: #e74c3c; padding: 4px 10px; border-radius: 20px; margin-right: 10px; display: inline-block;">Outlined Red</span>
                <span style="border: 2px solid #3498db; color: #3498db; padding: 4px 10px; border-radius: 20px; margin-right: 10px; display: inline-block;">Outlined Blue</span>
                <span style="border: 2px dashed #27ae60; color: #27ae60; padding: 4px 10px; border-radius: 4px; display: inline-block;">Dashed Green</span>
            </div>
        </div>

        <!-- Case 7: Pseudo-element text ordering -->
        <div style="background: white; padding: 15px; border-radius: 6px;">
            <h3 style="margin: 0 0 10px 0; color: #555; font-size: 14px;">Case 7: 伪元素与内联合并</h3>
            <p style="margin: 0;">
                普通文本 <i style="color: #d32f2f;">斜体文本</i> 继续。
            </p>
        </div>
    </div>`
  },
  {
    name: '[Advanced] Form Controls Test',
    description: 'Test form elements: input, select, textarea with values and placeholders',
    category: 'advanced',
    html: `<div style="width: 600px; padding: 30px; background: #f9f9f9; font-family: Arial, sans-serif;">
        <h2 style="margin: 0 0 20px 0; color: #333;">Form Controls Test</h2>

        <!-- Text input with value -->
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Text Input (value)</label>
            <input type="text" value="John Doe" style="width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 16px; box-sizing: border-box;" />
        </div>

        <!-- Text input with placeholder -->
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Text Input (placeholder)</label>
            <input type="text" placeholder="Enter your email..." style="width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 16px; box-sizing: border-box;" />
        </div>

        <!-- Password input -->
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Password Input</label>
            <input type="password" value="secret" style="width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 16px; box-sizing: border-box;" />
        </div>

        <!-- Select -->
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Select</label>
            <select style="width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 16px; box-sizing: border-box; background: white;">
                <option>Apple</option>
                <option selected>Banana</option>
                <option>Cherry</option>
            </select>
        </div>

        <!-- Textarea with value -->
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Textarea (value)</label>
            <textarea style="width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 16px; box-sizing: border-box; resize: none;" rows="3">This is some text content in a textarea element.</textarea>
        </div>

        <!-- Textarea with placeholder -->
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Textarea (placeholder)</label>
            <textarea placeholder="Write your message here..." style="width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 16px; box-sizing: border-box; resize: none;" rows="2"></textarea>
        </div>

        <!-- Checkbox -->
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Checkboxes</label>
            <div style="display: flex; gap: 16px; align-items: center;">
                <label style="display: flex; align-items: center; gap: 6px; font-size: 14px; color: #333;">
                    <input type="checkbox" checked style="width: 16px; height: 16px;" />
                    Checked
                </label>
                <label style="display: flex; align-items: center; gap: 6px; font-size: 14px; color: #333;">
                    <input type="checkbox" style="width: 16px; height: 16px;" />
                    Unchecked
                </label>
            </div>
        </div>

        <!-- Radio -->
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Radio Buttons</label>
            <div style="display: flex; gap: 16px; align-items: center;">
                <label style="display: flex; align-items: center; gap: 6px; font-size: 14px; color: #333;">
                    <input type="radio" name="demo" checked style="width: 16px; height: 16px;" />
                    Selected
                </label>
                <label style="display: flex; align-items: center; gap: 6px; font-size: 14px; color: #333;">
                    <input type="radio" name="demo" style="width: 16px; height: 16px;" />
                    Unselected
                </label>
            </div>
        </div>

        <!-- Range slider -->
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Range Slider (50%)</label>
            <input type="range" min="0" max="100" value="50" style="width: 100%; height: 20px;" />
        </div>

        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Range Slider (0%)</label>
            <input type="range" min="0" max="100" value="0" style="width: 100%; height: 20px;" />
        </div>

        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px;">Range Slider (100%)</label>
            <input type="range" min="0" max="100" value="100" style="width: 100%; height: 20px;" />
        </div>

        <!-- Submit button (input type) -->
        <div style="margin-bottom: 16px;">
            <input type="submit" value="Submit Form" style="padding: 10px 24px; background: #4285f4; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer;" />
            <input type="button" value="Cancel" style="padding: 10px 24px; background: #f5f5f5; color: #333; border: 1px solid #ccc; border-radius: 4px; font-size: 16px; cursor: pointer; margin-left: 8px;" />
        </div>

        <!-- Button element (should use DOM children, not injection) -->
        <div>
            <button style="padding: 10px 24px; background: #34a853; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer;">Button Element</button>
        </div>
    </div>`
  },
  {
    name: '🌟 Radial Gradients',
    description: 'Radial gradient rendering tests',
    category: 'basic',
    html: `<div style="display: flex; flex-wrap: wrap; gap: 20px; padding: 20px; background: #f5f5f5;">
        <!-- circle gradient -->
        <div style="text-align: center;">
            <div style="width: 200px; height: 200px; background-image: radial-gradient(circle, #ff6b6b, #4ecdc4); border-radius: 8px; border: 2px solid #ddd;"></div>
            <p style="margin-top: 8px; font-size: 14px; color: #333;">circle gradient</p>
        </div>
        <!-- ellipse gradient -->
        <div style="text-align: center;">
            <div style="width: 300px; height: 150px; background-image: radial-gradient(ellipse, #667eea, #764ba2); border-radius: 8px; border: 2px solid #ddd;"></div>
            <p style="margin-top: 8px; font-size: 14px; color: #333;">ellipse gradient</p>
        </div>
        <!-- positioned circle -->
        <div style="text-align: center;">
            <div style="width: 200px; height: 200px; background-image: radial-gradient(circle at 25% 75%, #f093fb, #f5576c); border-radius: 8px; border: 2px solid #ddd;"></div>
            <p style="margin-top: 8px; font-size: 14px; color: #333;">positioned circle</p>
        </div>
        <!-- multi-stop radial -->
        <div style="text-align: center;">
            <div style="width: 200px; height: 200px; background-image: radial-gradient(circle, #667eea 0%, #764ba2 50%, #f093fb 100%); border-radius: 8px; border: 2px solid #ddd;"></div>
            <p style="margin-top: 8px; font-size: 14px; color: #333;">multi-stop radial</p>
        </div>
    </div>`
  },
  {
    name: '🌟 Multiple Background Images',
    description: 'Multiple background layers and image combinations',
    category: 'basic',
    html: `<div style="display: flex; flex-wrap: wrap; gap: 20px; padding: 20px; background: #f5f5f5;">
        <!-- gradient overlay on image -->
        <div style="text-align: center;">
            <div style="width: 300px; height: 200px; background: linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url('https://picsum.photos/300/200'); background-size: cover; border-radius: 8px; display: flex; align-items: flex-end; padding: 16px;">
                <p style="color: white; font-size: 18px; margin: 0;">Gradient Overlay</p>
            </div>
            <p style="margin-top: 8px; font-size: 14px; color: #333;">gradient + image</p>
        </div>
        <!-- radial gradient overlay -->
        <div style="text-align: center;">
            <div style="width: 300px; height: 200px; background: radial-gradient(circle, rgba(102,126,234,0.8), rgba(118,75,162,0.8)), url('https://picsum.photos/300/200?random=2'); background-size: cover; border-radius: 8px;"></div>
            <p style="margin-top: 8px; font-size: 14px; color: #333;">radial gradient + image</p>
        </div>
        <!-- dual image backgrounds -->
        <div style="text-align: center;">
            <div style="width: 300px; height: 200px; background-image: url('https://picsum.photos/100/100?random=12'), url('https://picsum.photos/600/400?random=13'); background-size: 100px 100px, cover; background-position: top 10px right 10px, center; background-repeat: no-repeat, no-repeat; border-radius: 8px; border: 2px solid #ddd;"></div>
            <p style="margin-top: 8px; font-size: 14px; color: #333;">dual image (small + cover)</p>
        </div>
        <!-- triple layer: gradient + two images -->
        <div style="text-align: center;">
            <div style="width: 300px; height: 200px; background-image: linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.5)), url('https://picsum.photos/100/100?random=14'), url('https://picsum.photos/600/400?random=15'); background-size: cover, 80px 80px, cover; background-position: center, bottom 10px left 10px, center; background-repeat: no-repeat, no-repeat, no-repeat; border-radius: 8px; border: 2px solid #ddd;"></div>
            <p style="margin-top: 8px; font-size: 14px; color: #333;">gradient + two images</p>
        </div>
    </div>`
  },
  {
    name: '🌟 Juejin Homepage',
    description: '掘金首页完整页面，包含导航栏、文章列表、侧边栏热门文章/作者推荐等',
    category: 'advanced',
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif; background: #f4f5f5; min-width: 960px; color: #252933;">

  <!-- Header -->
  <header style="background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); position: sticky; top: 0; z-index: 100; height: 60px; display: flex; align-items: center; padding: 0 20px;">
    <div style="display: flex; align-items: center; width: 100%; max-width: 1220px; margin: 0 auto;">
      <!-- Logo -->
      <a href="javascript:void(0)" style="display: flex; align-items: center; text-decoration: none; margin-right: 24px;">
        <svg width="107" height="28" viewBox="0 0 107 28" fill="none"><path d="M22.5 16.5L13 24l-9.5-7.5L13 4l9.5 12.5z" fill="#1E80FF"/><text x="30" y="20" fill="#252933" font-size="16" font-weight="bold">稀土掘金</text></svg>
      </a>
      <!-- Nav -->
      <nav style="display: flex; align-items: center; gap: 4px; flex: 1;">
        <a href="javascript:void(0)" style="padding: 8px 12px; font-size: 14px; color: #1e80ff; text-decoration: none; font-weight: 500;">首页</a>
        <a href="javascript:void(0)" style="padding: 8px 12px; font-size: 14px; color: #515767; text-decoration: none;">沸点</a>
        <a href="javascript:void(0)" style="padding: 8px 12px; font-size: 14px; color: #515767; text-decoration: none;">课程</a>
        <a href="javascript:void(0)" style="padding: 8px 12px; font-size: 14px; color: #515767; text-decoration: none;">直播</a>
        <a href="javascript:void(0)" style="padding: 8px 12px; font-size: 14px; color: #515767; text-decoration: none;">活动</a>
      </nav>
      <!-- Search -->
      <div style="display: flex; align-items: center; background: #f2f3f5; border-radius: 4px; padding: 0 12px; height: 32px; width: 240px; margin-right: 16px;">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="#8a919f"><circle cx="7" cy="7" r="5" stroke="#8a919f" stroke-width="1.5" fill="none"/><line x1="10.5" y1="10.5" x2="14" y2="14" stroke="#8a919f" stroke-width="1.5"/></svg>
        <span style="margin-left: 8px; font-size: 14px; color: #8a919f;">搜索稀土掘金</span>
      </div>
      <!-- Creator button -->
      <button style="background: #1e80ff; color: #fff; border: none; border-radius: 4px; padding: 0 16px; height: 32px; font-size: 14px; cursor: pointer; margin-right: 12px;">创作者中心</button>
      <!-- Login -->
      <button style="background: none; color: #1e80ff; border: 1px solid #1e80ff; border-radius: 4px; padding: 0 16px; height: 32px; font-size: 14px; cursor: pointer;">登录</button>
    </div>
  </header>

  <!-- Main layout -->
  <div style="max-width: 1220px; margin: 0 auto; display: flex; padding: 20px 0;">

    <!-- Left sidebar -->
    <nav style="width: 180px; flex-shrink: 0; margin-right: 20px;">
      <div style="background: #fff; border-radius: 4px; padding: 8px 0; position: sticky; top: 80px;">
        <a href="javascript:void(0)" style="display: flex; align-items: center; padding: 8px 16px; font-size: 14px; color: #1e80ff; background: #eaf2ff; text-decoration: none; font-weight: 500;">
          <span style="width: 18px; height: 18px; margin-right: 8px; background: #1e80ff; border-radius: 3px; display: inline-block;"></span>综合
        </a>
        <a href="javascript:void(0)" style="display: flex; align-items: center; padding: 8px 16px; font-size: 14px; color: #515767; text-decoration: none;">
          <span style="width: 18px; height: 18px; margin-right: 8px; background: #8a919f; border-radius: 3px; display: inline-block;"></span>后端
        </a>
        <a href="javascript:void(0)" style="display: flex; align-items: center; padding: 8px 16px; font-size: 14px; color: #515767; text-decoration: none;">
          <span style="width: 18px; height: 18px; margin-right: 8px; background: #8a919f; border-radius: 3px; display: inline-block;"></span>前端
        </a>
        <a href="javascript:void(0)" style="display: flex; align-items: center; padding: 8px 16px; font-size: 14px; color: #515767; text-decoration: none;">
          <span style="width: 18px; height: 18px; margin-right: 8px; background: #8a919f; border-radius: 3px; display: inline-block;"></span>Android
        </a>
        <a href="javascript:void(0)" style="display: flex; align-items: center; padding: 8px 16px; font-size: 14px; color: #515767; text-decoration: none;">
          <span style="width: 18px; height: 18px; margin-right: 8px; background: #8a919f; border-radius: 3px; display: inline-block;"></span>iOS
        </a>
        <a href="javascript:void(0)" style="display: flex; align-items: center; padding: 8px 16px; font-size: 14px; color: #515767; text-decoration: none;">
          <span style="width: 18px; height: 18px; margin-right: 8px; background: #8a919f; border-radius: 3px; display: inline-block;"></span>人工智能
        </a>
        <a href="javascript:void(0)" style="display: flex; align-items: center; padding: 8px 16px; font-size: 14px; color: #515767; text-decoration: none;">
          <span style="width: 18px; height: 18px; margin-right: 8px; background: #8a919f; border-radius: 3px; display: inline-block;"></span>开发工具
        </a>
      </div>
    </nav>

    <!-- Center: Article Feed -->
    <main style="flex: 1; min-width: 0;">
      <!-- Sort tabs -->
      <div style="background: #fff; border-radius: 4px 4px 0 0; padding: 0 16px; display: flex; align-items: center; height: 44px; border-bottom: 1px solid #e4e6eb; margin-bottom: 0;">
        <a href="javascript:void(0)" style="font-size: 14px; color: #1e80ff; font-weight: 500; text-decoration: none; margin-right: 24px; position: relative; line-height: 44px; border-bottom: 2px solid #1e80ff;">推荐</a>
        <a href="javascript:void(0)" style="font-size: 14px; color: #515767; text-decoration: none; line-height: 44px;">最新</a>
      </div>

      <!-- Article 1 -->
      <div style="background: #fff; padding: 12px 20px; border-bottom: 1px solid #e4e6eb; cursor: pointer;">
        <div style="display: flex; align-items: flex-start;">
          <div style="flex: 1; min-width: 0;">
            <a href="javascript:void(0)" style="font-weight: 700; font-size: 16px; line-height: 24px; color: #252933; text-decoration: none; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">被裁后我做了一款免费的AI工具 拿到了PH日榜No.1</a>
            <div style="margin: 8px 0 10px;">
              <span style="color: #8a919f; font-size: 13px; line-height: 22px; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">年初的时候被裁了，在经历了很长一段时间的迷茫后，开始认真做一款AI工具。没想到，昨天拿到了Product Hunt日榜第一。</span>
            </div>
            <div style="display: flex; align-items: center; font-size: 13px; color: #8a919f;">
              <span style="color: #515767; margin-right: 12px;">不白吃的码农</span>
              <span style="margin-right: 12px;">👁 6.4k</span>
              <span style="margin-right: 12px;">👍 80</span>
              <span style="margin-right: 12px;">💬 4</span>
              <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px; margin-right: 8px;">AIGC</span>
              <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px;">Claude</span>
            </div>
          </div>
          <div style="flex-shrink: 0; width: 120px; height: 80px; margin-left: 24px; border-radius: 4px; overflow: hidden; background: #e4e6eb;">
            <img src="https://picsum.photos/120/80?random=30" alt="" style="width: 100%; height: 100%; object-fit: cover;">
          </div>
        </div>
      </div>

      <!-- Article 2 -->
      <div style="background: #fff; padding: 12px 20px; border-bottom: 1px solid #e4e6eb; cursor: pointer;">
        <div style="display: flex; align-items: flex-start;">
          <div style="flex: 1; min-width: 0;">
            <a href="javascript:void(0)" style="font-weight: 700; font-size: 16px; line-height: 24px; color: #252933; text-decoration: none; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">Vue3.5 新特性全解析：useTemplateRef、Teleport 延迟加载</a>
            <div style="margin: 8px 0 10px;">
              <span style="color: #8a919f; font-size: 13px; line-height: 22px; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">Vue 3.5 带来了多项重要更新，包括响应式系统优化、SSR 改进、useTemplateRef 等新特性。本文将逐一解析这些变化。</span>
            </div>
            <div style="display: flex; align-items: center; font-size: 13px; color: #8a919f;">
              <span style="color: #515767; margin-right: 12px;">前端小李</span>
              <span style="margin-right: 12px;">👁 3.2k</span>
              <span style="margin-right: 12px;">👍 156</span>
              <span style="margin-right: 12px;">💬 23</span>
              <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px; margin-right: 8px;">前端</span>
              <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px;">Vue.js</span>
            </div>
          </div>
          <div style="flex-shrink: 0; width: 120px; height: 80px; margin-left: 24px; border-radius: 4px; overflow: hidden; background: #e4e6eb;">
            <img src="https://picsum.photos/120/80?random=31" alt="" style="width: 100%; height: 100%; object-fit: cover;">
          </div>
        </div>
      </div>

      <!-- Article 3 (no thumbnail) -->
      <div style="background: #fff; padding: 12px 20px; border-bottom: 1px solid #e4e6eb; cursor: pointer;">
        <div style="flex: 1; min-width: 0;">
          <a href="javascript:void(0)" style="font-weight: 700; font-size: 16px; line-height: 24px; color: #252933; text-decoration: none; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">深入理解 Go 语言 GMP 调度模型：从源码到实践</a>
          <div style="margin: 8px 0 10px;">
            <span style="color: #8a919f; font-size: 13px; line-height: 22px; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">Go 语言以其强大的并发能力著称，而这背后的核心就是 GMP 调度模型。本文将从源码角度深入分析 Goroutine、Machine 和 Processor 的协作机制。</span>
          </div>
          <div style="display: flex; align-items: center; font-size: 13px; color: #8a919f;">
            <span style="color: #515767; margin-right: 12px;">Go学堂</span>
            <span style="margin-right: 12px;">👁 1.8k</span>
            <span style="margin-right: 12px;">👍 45</span>
            <span style="margin-right: 12px;">💬 12</span>
            <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px; margin-right: 8px;">后端</span>
            <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px;">Go</span>
          </div>
        </div>
      </div>

      <!-- Article 4 -->
      <div style="background: #fff; padding: 12px 20px; border-bottom: 1px solid #e4e6eb; cursor: pointer;">
        <div style="display: flex; align-items: flex-start;">
          <div style="flex: 1; min-width: 0;">
            <a href="javascript:void(0)" style="font-weight: 700; font-size: 16px; line-height: 24px; color: #252933; text-decoration: none; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">2024 年了，CSS 原来可以这么写：新特性完全指南</a>
            <div style="margin: 8px 0 10px;">
              <span style="color: #8a919f; font-size: 13px; line-height: 22px; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">CSS 近两年的发展速度令人惊叹，container queries、:has() 选择器、subgrid、CSS nesting 等特性已经可以在生产中使用了。</span>
            </div>
            <div style="display: flex; align-items: center; font-size: 13px; color: #8a919f;">
              <span style="color: #515767; margin-right: 12px;">CSS魔法师</span>
              <span style="margin-right: 12px;">👁 5.1k</span>
              <span style="margin-right: 12px;">👍 230</span>
              <span style="margin-right: 12px;">💬 34</span>
              <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px; margin-right: 8px;">前端</span>
              <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px;">CSS</span>
            </div>
          </div>
          <div style="flex-shrink: 0; width: 120px; height: 80px; margin-left: 24px; border-radius: 4px; overflow: hidden; background: #e4e6eb;">
            <img src="https://picsum.photos/120/80?random=32" alt="" style="width: 100%; height: 100%; object-fit: cover;">
          </div>
        </div>
      </div>

      <!-- Article 5 (no thumbnail) -->
      <div style="background: #fff; padding: 12px 20px; border-bottom: 1px solid #e4e6eb; cursor: pointer;">
        <div style="flex: 1; min-width: 0;">
          <a href="javascript:void(0)" style="font-weight: 700; font-size: 16px; line-height: 24px; color: #252933; text-decoration: none; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">MySQL 八股文终结者：一文搞懂索引、锁、事务、MVCC</a>
          <div style="margin: 8px 0 10px;">
            <span style="color: #8a919f; font-size: 13px; line-height: 22px; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">面试中 MySQL 几乎是必问的，本文将索引结构、锁机制、事务隔离级别和 MVCC 实现原理一次性讲清楚，配合图解，让你彻底告别死记硬背。</span>
          </div>
          <div style="display: flex; align-items: center; font-size: 13px; color: #8a919f;">
            <span style="color: #515767; margin-right: 12px;">数据库老司机</span>
            <span style="margin-right: 12px;">👁 8.9k</span>
            <span style="margin-right: 12px;">👍 412</span>
            <span style="margin-right: 12px;">💬 56</span>
            <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px; margin-right: 8px;">后端</span>
            <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px;">MySQL</span>
          </div>
        </div>
      </div>

      <!-- Article 6 -->
      <div style="background: #fff; padding: 12px 20px; border-bottom: 1px solid #e4e6eb; border-radius: 0 0 4px 4px; cursor: pointer;">
        <div style="display: flex; align-items: flex-start;">
          <div style="flex: 1; min-width: 0;">
            <a href="javascript:void(0)" style="font-weight: 700; font-size: 16px; line-height: 24px; color: #252933; text-decoration: none; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">React Server Components 实战：从概念到生产部署</a>
            <div style="margin: 8px 0 10px;">
              <span style="color: #8a919f; font-size: 13px; line-height: 22px; display: -webkit-box; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">RSC 不只是 SSR 的升级版。本文通过一个真实项目，展示如何正确使用 Server Components，以及它如何改变前端的数据获取方式。</span>
            </div>
            <div style="display: flex; align-items: center; font-size: 13px; color: #8a919f;">
              <span style="color: #515767; margin-right: 12px;">React探索者</span>
              <span style="margin-right: 12px;">👁 4.3k</span>
              <span style="margin-right: 12px;">👍 189</span>
              <span style="margin-right: 12px;">💬 28</span>
              <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px; margin-right: 8px;">前端</span>
              <span style="display: inline-block; padding: 0 8px; height: 22px; line-height: 22px; font-size: 12px; background: #f2f3f5; border-radius: 2px;">React</span>
            </div>
          </div>
          <div style="flex-shrink: 0; width: 120px; height: 80px; margin-left: 24px; border-radius: 4px; overflow: hidden; background: #e4e6eb;">
            <img src="https://picsum.photos/120/80?random=33" alt="" style="width: 100%; height: 100%; object-fit: cover;">
          </div>
        </div>
      </div>
    </main>

    <!-- Right sidebar -->
    <aside style="width: 240px; flex-shrink: 0; margin-left: 20px;">
      <!-- Sign-in card -->
      <div style="background: #fff; border-radius: 4px; padding: 16px; margin-bottom: 12px;">
        <div style="font-size: 14px; color: #252933; margin-bottom: 12px;">🌙 晚上好！点亮在社区的每一天</div>
        <button style="width: 100%; height: 32px; background: #1e80ff; color: #fff; border: none; border-radius: 4px; font-size: 14px; cursor: pointer;">去签到</button>
      </div>

      <!-- Hot articles -->
      <div style="background: #fff; border-radius: 4px; padding: 0; position: sticky; top: 80px;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 12px;">
          <span style="font-size: 14px; font-weight: 600; color: #252933;">🔥 文章榜</span>
          <a href="javascript:void(0)" style="font-size: 12px; color: #8a919f; text-decoration: none;">换一换</a>
        </div>
        <!-- Hot item 1 -->
        <a href="javascript:void(0)" style="display: flex; align-items: flex-start; padding: 8px 16px; text-decoration: none;">
          <span style="width: 18px; height: 18px; border-radius: 4px; background: #ff4d4f; color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 10px; margin-top: 2px;">1</span>
          <span style="font-size: 13px; color: #252933; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;">Chrome 推出原生 AI API，前端开发迎来新纪元</span>
        </a>
        <!-- Hot item 2 -->
        <a href="javascript:void(0)" style="display: flex; align-items: flex-start; padding: 8px 16px; text-decoration: none;">
          <span style="width: 18px; height: 18px; border-radius: 4px; background: #ff7a45; color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 10px; margin-top: 2px;">2</span>
          <span style="font-size: 13px; color: #252933; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;">字节跳动开源 Rspack：基于 Rust 的高性能构建工具</span>
        </a>
        <!-- Hot item 3 -->
        <a href="javascript:void(0)" style="display: flex; align-items: flex-start; padding: 8px 16px; text-decoration: none;">
          <span style="width: 18px; height: 18px; border-radius: 4px; background: #ffa940; color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 10px; margin-top: 2px;">3</span>
          <span style="font-size: 13px; color: #252933; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;">从零搭建企业级 CI/CD 流水线实战</span>
        </a>
        <!-- Hot item 4 -->
        <a href="javascript:void(0)" style="display: flex; align-items: flex-start; padding: 8px 16px; text-decoration: none;">
          <span style="width: 18px; height: 18px; border-radius: 4px; background: #e4e6eb; color: #8a919f; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 10px; margin-top: 2px;">4</span>
          <span style="font-size: 13px; color: #252933; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;">为什么说 TypeScript 5.5 是一次重大升级</span>
        </a>
        <!-- Hot item 5 -->
        <a href="javascript:void(0)" style="display: flex; align-items: flex-start; padding: 8px 16px 16px; text-decoration: none;">
          <span style="width: 18px; height: 18px; border-radius: 4px; background: #e4e6eb; color: #8a919f; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 10px; margin-top: 2px;">5</span>
          <span style="font-size: 13px; color: #252933; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;">Rust 在 WebAssembly 中的实践与性能测试</span>
        </a>
        <div style="border-top: 1px solid #e4e6eb; padding: 10px 16px; text-align: center;">
          <a href="javascript:void(0)" style="font-size: 13px; color: #1e80ff; text-decoration: none;">查看更多 ›</a>
        </div>
      </div>
    </aside>

  </div>
</div>`
  },
  {
    name: '🌟🌟 [Advanced] Line Clamp Truncation',
    description: 'Test -webkit-line-clamp text truncation in various scenarios',
    category: 'advanced',
    html: `<div style="width: 600px; padding: 40px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h1 style="margin: 0 0 20px 0; color: #333; font-size: 28px;">Line Clamp 文本截断测试</h1>

  <!-- Case 1: Single line clamp, text overflows -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">1. 单行截断（文字溢出）</h3>
    <p style="margin: 0; font-size: 14px; color: #252933; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 1; width: 200px;">
      这是一段很长的文本内容需要被截断显示省略号效果
    </p>
    <p style="margin: 8px 0 0 0; color: #999; font-size: 12px;">✅ 预期：单行显示，末尾省略号</p>
  </div>

  <!-- Case 2: Single line clamp, text fits -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">2. 单行截断（文字未溢出）</h3>
    <p style="margin: 0; font-size: 14px; color: #252933; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 1; width: 400px;">
      短文本不截断
    </p>
    <p style="margin: 8px 0 0 0; color: #999; font-size: 12px;">✅ 预期：正常显示，无省略号</p>
  </div>

  <!-- Case 3: Two line clamp -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">3. 两行截断</h3>
    <p style="margin: 0; font-size: 14px; color: #252933; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; width: 250px;">
      Rust 在 WebAssembly 中的实践与性能测试，这是一篇关于前端技术的深度文章，讨论了最新的 Wasm 性能优化方法。
    </p>
    <p style="margin: 8px 0 0 0; color: #999; font-size: 12px;">✅ 预期：最多两行，末尾省略号</p>
  </div>

  <!-- Case 4: Line clamp with inline children (like Juejin hot topic) -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">4. 带内联子元素的截断（掘金话题样式）</h3>
    <div style="display: flex; align-items: center; width: 200px;">
      <p style="margin: 0; flex: 1; font-size: 14px; color: #252933; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect fill='%23ddd' width='16' height='16' rx='2'/%3E%3C/svg%3E" style="width: 16px; height: 16px; vertical-align: middle; margin-right: 4px;" />
        <span>#工作中做得最正确的一件事#</span>
      </p>
      <span style="margin-left: 10px; font-size: 12px; color: #8a919f; white-space: nowrap;">433k</span>
    </div>
    <p style="margin: 8px 0 0 0; color: #999; font-size: 12px;">✅ 预期：图标+文字单行截断，右侧数字正常</p>
  </div>

  <!-- Case 5: Line clamp with flex parent -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">5. Flex 容器内的截断</h3>
    <div style="display: flex; align-items: flex-start; width: 300px;">
      <span style="width: 18px; height: 18px; border-radius: 4px; background: #ff6b6b; color: white; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 10px; margin-top: 2px;">1</span>
      <span style="font-size: 13px; color: #252933; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;">
        前端框架性能对比分析：React vs Vue vs Svelte 的最新 Benchmark 测试结果与优化建议
      </span>
    </div>
    <p style="margin: 8px 0 0 0; color: #999; font-size: 12px;">✅ 预期：序号不截断，标题最多两行截断</p>
  </div>

  <!-- Case 6: Nested inline spans with line-clamp:1 (Juejin hot topic list) -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">6. 嵌套内联 span + line-clamp:1（话题标签列表）</h3>
    <div style="display: flex; flex-wrap: wrap; gap: 8px; width: 400px;">
      <a href="javascript:void(0)" style="display: flex; align-items: center; gap: 4px; text-decoration: none; padding: 4px 8px; background: #f2f3f5; border-radius: 4px; max-width: 160px;">
        <span style="font-size: 13px; color: #1e80ff; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 1; word-break: break-all;">
          <span><span>#OpenClaw今天想篡位了吗#</span></span>
        </span>
        <span style="font-size: 12px; color: #8a919f; white-space: nowrap; flex-shrink: 0;">847k</span>
      </a>
      <a href="javascript:void(0)" style="display: flex; align-items: center; gap: 4px; text-decoration: none; padding: 4px 8px; background: #f2f3f5; border-radius: 4px; max-width: 180px;">
        <span style="font-size: 13px; color: #1e80ff; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 1; word-break: break-all;">
          <span><span>#工作中做得最正确的一件事#</span></span>
        </span>
        <span style="font-size: 12px; color: #8a919f; white-space: nowrap; flex-shrink: 0;">435k</span>
      </a>
      <a href="javascript:void(0)" style="display: flex; align-items: center; gap: 4px; text-decoration: none; padding: 4px 8px; background: #f2f3f5; border-radius: 4px; max-width: 130px;">
        <span style="font-size: 13px; color: #1e80ff; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 1; word-break: break-all;">
          <span><span>#每天一个知识点#</span></span>
        </span>
        <span style="font-size: 12px; color: #8a919f; white-space: nowrap; flex-shrink: 0;">50.1m</span>
      </a>
    </div>
    <p style="margin: 8px 0 0 0; color: #999; font-size: 12px;">✅ 预期：每个标签单行显示，长文本截断不换行，右侧数字正常</p>
  </div>

  <!-- Case 7: Outer line-clamp:1 with nested wrapping text (Juejin p.content pattern) -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">7. 外层 line-clamp:1 + 内层嵌套长文本</h3>
    <p style="margin: 0 0 8px 0; color: #666; font-size: 12px;">line-clamp 在 p 容器上，内层 span 文本超长会换行，但外层应裁剪为1行</p>
    <div style="display: flex; gap: 12px; align-items: flex-start;">
      <div style="display: flex; align-items: baseline; width: 180px; gap: 4px;">
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect fill='%23e8e8e8' width='16' height='16' rx='2'/%3E%3C/svg%3E" style="width: 16px; height: 16px; flex-shrink: 0;" />
        <p style="margin: 0; flex: 1; font-size: 14px; color: #252933; line-height: 20px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">
          <span><span>#工作中做得最正确的一件事#</span></span>
        </p>
      </div>
      <div style="display: flex; align-items: baseline; width: 180px; gap: 4px;">
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect fill='%23e8e8e8' width='16' height='16' rx='2'/%3E%3C/svg%3E" style="width: 16px; height: 16px; flex-shrink: 0;" />
        <p style="margin: 0; flex: 1; font-size: 14px; color: #252933; line-height: 20px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">
          <span><span>#短标签#</span></span>
        </p>
      </div>
    </div>
    <p style="margin: 8px 0 0 0; color: #999; font-size: 12px;">✅ 预期：左侧长文本单行截断+省略号，右侧短文本不截断。容器 clipsContent=true</p>
  </div>

  <!-- Case 8: No clamp reference -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">8. 无截断对照组</h3>
    <p style="margin: 0; font-size: 14px; color: #252933; line-height: 22px; width: 200px;">
      这是一段没有设置 line-clamp 的长文本，应该正常换行显示而不会被截断。
    </p>
    <p style="margin: 8px 0 0 0; color: #999; font-size: 12px;">✅ 预期：正常换行，无省略号</p>
  </div>
</div>`
  },
  {
    name: '🌟🌟 [Advanced] CSS Transforms',
    description: 'Test CSS transform properties: rotate, scale, translate, skew, matrix',
    category: 'advanced',
    html: `<div style="width: 800px; padding: 40px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h1 style="margin: 0 0 20px 0; color: #333; font-size: 28px;">CSS Transform 测试</h1>

  <!-- Case 1: Rotate -->
  <div style="background: white; padding: 40px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 20px 0; color: #333; font-size: 16px;">1. Rotate 旋转</h3>
    <div style="display: flex; gap: 40px; align-items: center; justify-content: center;">
      <div style="width: 80px; height: 80px; background: #1e80ff; border-radius: 8px; transform: rotate(15deg); display: flex; align-items: center; justify-content: center; color: white; font-size: 14px;">15°</div>
      <div style="width: 80px; height: 80px; background: #ff6b6b; border-radius: 8px; transform: rotate(45deg); display: flex; align-items: center; justify-content: center; color: white; font-size: 14px;">45°</div>
      <div style="width: 80px; height: 80px; background: #00b96b; border-radius: 8px; transform: rotate(-30deg); display: flex; align-items: center; justify-content: center; color: white; font-size: 14px;">-30°</div>
      <div style="width: 80px; height: 80px; background: #722ed1; border-radius: 8px; transform: rotate(90deg); display: flex; align-items: center; justify-content: center; color: white; font-size: 14px;">90°</div>
    </div>
    <p style="margin: 15px 0 0 0; color: #999; font-size: 12px; text-align: center;">✅ 预期：四个方块分别旋转 15°, 45°, -30°, 90°</p>
  </div>

  <!-- Case 2: Scale -->
  <div style="background: white; padding: 40px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 20px 0; color: #333; font-size: 16px;">2. Scale 缩放</h3>
    <div style="display: flex; gap: 60px; align-items: center; justify-content: center;">
      <div style="width: 60px; height: 60px; background: #1e80ff; border-radius: 8px; transform: scale(0.5); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">0.5x</div>
      <div style="width: 60px; height: 60px; background: #ff6b6b; border-radius: 8px; transform: scale(1.0); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">1.0x</div>
      <div style="width: 60px; height: 60px; background: #00b96b; border-radius: 8px; transform: scale(1.5); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">1.5x</div>
      <div style="width: 60px; height: 60px; background: #722ed1; border-radius: 8px; transform: scale(1.2, 0.8); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px;">1.2,0.8</div>
    </div>
    <p style="margin: 15px 0 0 0; color: #999; font-size: 12px; text-align: center;">✅ 预期：0.5x 缩小, 1.0x 原始, 1.5x 放大, 非等比缩放</p>
  </div>

  <!-- Case 3: Translate -->
  <div style="background: white; padding: 40px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 20px 0; color: #333; font-size: 16px;">3. Translate 平移</h3>
    <div style="position: relative; height: 120px; border: 1px dashed #ddd; border-radius: 4px;">
      <div style="position: absolute; left: 20px; top: 20px; width: 60px; height: 60px; background: #1e80ff; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 11px;">原位</div>
      <div style="position: absolute; left: 20px; top: 20px; width: 60px; height: 60px; background: rgba(255,107,107,0.8); border-radius: 8px; transform: translate(100px, 30px); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px;">+100,+30</div>
      <div style="position: absolute; right: 20px; top: 20px; width: 60px; height: 60px; background: rgba(0,185,107,0.8); border-radius: 8px; transform: translateX(-40px); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px;">X:-40</div>
      <div style="position: absolute; left: 300px; top: 10px; width: 60px; height: 60px; background: rgba(114,46,209,0.8); border-radius: 8px; transform: translateY(30px); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px;">Y:+30</div>
    </div>
    <p style="margin: 15px 0 0 0; color: #999; font-size: 12px; text-align: center;">✅ 预期：蓝色原位，红色右移+下移，绿色左移，紫色下移</p>
  </div>

  <!-- Case 4: Combined transforms -->
  <div style="background: white; padding: 40px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 20px 0; color: #333; font-size: 16px;">4. 组合变换</h3>
    <div style="display: flex; gap: 60px; align-items: center; justify-content: center;">
      <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #1e80ff, #722ed1); border-radius: 8px; transform: rotate(20deg) scale(1.1); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; text-align: center;">旋转+缩放</div>
      <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #ff6b6b, #ff9f43); border-radius: 8px; transform: rotate(-15deg) translate(10px, -5px); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; text-align: center;">旋转+平移</div>
      <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #00b96b, #00d9c8); border-radius: 8px; transform: scale(0.9) rotate(45deg); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; text-align: center;">缩放+旋转</div>
    </div>
    <p style="margin: 15px 0 0 0; color: #999; font-size: 12px; text-align: center;">✅ 预期：每个方块同时应用两种变换</p>
  </div>

  <!-- Case 5: Transform with text content -->
  <div style="background: white; padding: 40px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 20px 0; color: #333; font-size: 16px;">5. 文字变换</h3>
    <div style="display: flex; gap: 40px; align-items: center; justify-content: center;">
      <span style="font-size: 24px; font-weight: bold; color: #1e80ff; transform: rotate(-5deg); display: inline-block;">倾斜标题</span>
      <span style="font-size: 18px; color: #ff6b6b; transform: scale(1.3); display: inline-block;">放大文字</span>
      <span style="font-size: 16px; color: #00b96b; transform: rotate(10deg) scale(0.9); display: inline-block;">组合效果</span>
    </div>
    <p style="margin: 15px 0 0 0; color: #999; font-size: 12px; text-align: center;">✅ 预期：文字分别应用倾斜、放大、组合变换</p>
  </div>

  <!-- Case 6: Transform origin -->
  <div style="background: white; padding: 40px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 20px 0; color: #333; font-size: 16px;">6. Transform Origin 变换原点</h3>
    <div style="display: flex; gap: 60px; align-items: center; justify-content: center;">
      <div style="position: relative;">
        <div style="width: 80px; height: 80px; border: 2px dashed #ddd; border-radius: 8px;"></div>
        <div style="position: absolute; top: 0; left: 0; width: 80px; height: 80px; background: rgba(30,128,255,0.6); border-radius: 8px; transform: rotate(30deg); transform-origin: center center; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px;">center</div>
      </div>
      <div style="position: relative;">
        <div style="width: 80px; height: 80px; border: 2px dashed #ddd; border-radius: 8px;"></div>
        <div style="position: absolute; top: 0; left: 0; width: 80px; height: 80px; background: rgba(255,107,107,0.6); border-radius: 8px; transform: rotate(30deg); transform-origin: top left; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px;">top-left</div>
      </div>
      <div style="position: relative;">
        <div style="width: 80px; height: 80px; border: 2px dashed #ddd; border-radius: 8px;"></div>
        <div style="position: absolute; top: 0; left: 0; width: 80px; height: 80px; background: rgba(0,185,107,0.6); border-radius: 8px; transform: rotate(30deg); transform-origin: bottom right; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px;">bottom-right</div>
      </div>
    </div>
    <p style="margin: 15px 0 0 0; color: #999; font-size: 12px; text-align: center;">✅ 预期：相同旋转角度，不同旋转中心导致不同位置</p>
  </div>
</div>`
  },
  {
    name: '🌟🌟 [Layout] Deep Nesting & Passthrough Frames',
    description: 'Test deep single-child wrapper chains that should be flattened',
    category: 'layout',
    html: `<div style="width: 700px; padding: 30px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333; font-size: 24px;">深层嵌套 & 透传容器测试</h2>

  <!-- Case 1: Deep single-child chain (like Google search result links) -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">1. 深层单子节点链</h3>
    <div>
      <div>
        <div>
          <div>
            <a href="javascript:void(0)" style="color: #1a0dab; font-size: 20px; text-decoration: none;">
              <span>
                <span>Google 搜索结果标题 - 这是一个深层嵌套的链接</span>
              </span>
            </a>
          </div>
        </div>
      </div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：中间无意义的包装层应被简化，只保留有样式的容器</p>
  </div>

  <!-- Case 2: Wrapper with identical dimensions to child -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">2. 同尺寸透传包装</h3>
    <div style="width: 300px;">
      <div style="width: 300px;">
        <div style="width: 300px;">
          <p style="margin: 0; font-size: 14px; color: #4d5156; line-height: 22px;">这段文字被三层宽度完全相同的 div 包裹，这些 div 没有自己的样式。</p>
        </div>
      </div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：冗余包装层应被合并</p>
  </div>

  <!-- Case 3: Search result card pattern -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">3. 搜索结果卡片嵌套</h3>
    <div style="margin-bottom: 24px;">
      <div>
        <div>
          <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26'%3E%3Ccircle cx='13' cy='13' r='13' fill='%234285f4'/%3E%3Ctext x='13' y='17' text-anchor='middle' fill='white' font-size='14'%3EG%3C/text%3E%3C/svg%3E" style="width: 26px; height: 26px; margin-right: 12px; border-radius: 50%;" />
            <div>
              <span style="font-size: 14px; color: #202124;">www.example.com</span>
              <span style="font-size: 12px; color: #4d5156;"> › 路径 › 子路径</span>
            </div>
          </div>
          <div>
            <div>
              <a href="javascript:void(0)" style="color: #1a0dab; font-size: 20px; text-decoration: none; line-height: 26px;">
                <h3 style="margin: 0; font-weight: 400; font-size: 20px; line-height: 26px;">搜索结果标题 - Example Website</h3>
              </a>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div style="font-size: 14px; color: #4d5156; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;">
          这是搜索结果的描述文本。它通常会比较长，可能包含<em style="font-weight: bold; font-style: normal;">关键词高亮</em>，然后继续展示更多相关内容，直到被截断为止。该段落可能涉及多方面的信息，包括技术细节和使用说明。
        </div>
      </div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：层级合理，描述2行截断，em标签高亮保留</p>
  </div>

  <!-- Case 4: Multiple single-child flex containers -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">4. 嵌套 Flex 容器</h3>
    <div style="display: flex;">
      <div style="display: flex;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 32px; height: 32px; background: #1e80ff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 14px;">A</span>
          <span style="font-size: 16px; color: #202124;">用户名</span>
        </div>
      </div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：外层两个空 flex 应被合并</p>
  </div>
</div>`
  },
  {
    name: '🌟🌟 [Layout] Inline Text Overflow & Em Tags',
    description: 'Test inline elements (em, strong, span) inside text with line-height mismatch',
    category: 'layout',
    html: `<div style="width: 700px; padding: 30px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333; font-size: 24px;">内联文字溢出 & Em 标签测试</h2>

  <!-- Case 1: em inside paragraph (Google search highlight) -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">1. em 高亮关键词</h3>
    <p style="margin: 0; font-size: 14px; color: #4d5156; line-height: 22px;">
      今日<em style="font-weight: bold; font-style: normal;">热榜</em>是一个实时更新的内容排行列表，来自<em style="font-weight: bold; font-style: normal;">知乎</em>、V2EX、微博等多个平台的热门话题讨论，为用户提供全面的<em style="font-weight: bold; font-style: normal;">热点</em>资讯。
    </p>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：em 标签加粗但不改变行高，文字同行排列</p>
  </div>

  <!-- Case 2: Mixed inline elements -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">2. 混合内联元素</h3>
    <p style="margin: 0; font-size: 14px; color: #333; line-height: 24px;">
      这是<strong style="color: #1a0dab;">加粗链接</strong>和<em style="color: #d93025;">斜体强调</em>以及<span style="background: #fce8e6; padding: 0 4px; border-radius: 2px;">标记文本</span>混合在一起的段落。
    </p>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：所有内联元素同行排列，各自样式保留</p>
  </div>

  <!-- Case 3: Line-clamp with em children (the core bug) -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">3. Line-clamp + em 子元素（截断传播 Bug）</h3>
    <div style="width: 400px; font-size: 14px; color: #4d5156; line-height: 22px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;">
      这是一段包含<em style="font-weight: bold; font-style: normal;">关键词高亮</em>的搜索描述。当使用 -webkit-line-clamp 设置为 2 行截断时，应该是容器层面的截断，而不应该把 maxLines 传播到每个内联子元素（如 em、span）上。这里需要足够长的文本来触发截断效果，继续填充更多内容。
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：整段2行截断，em 内的"关键词高亮"不单独截断</p>
  </div>

  <!-- Case 4: Nested inline spans with different font sizes -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">4. 不同字号内联混排</h3>
    <p style="margin: 0; font-size: 14px; color: #333; line-height: 22px;">
      正常文字<span style="font-size: 12px; color: #70757a;">（小号注释）</span>继续正文<span style="font-size: 18px; color: #1a0dab;">大号标题</span>然后回到正常。
    </p>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：不同字号沿基线对齐，容器高度容纳最大字号</p>
  </div>

  <!-- Case 5: Superscript and subscript inline -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">5. 上标下标混排</h3>
    <p style="margin: 0; font-size: 16px; color: #333; line-height: 24px;">
      E = mc<sup style="font-size: 10px; vertical-align: super;">2</sup> 和 H<sub style="font-size: 10px; vertical-align: sub;">2</sub>O 是常见的公式。
    </p>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：上标下标正确偏移，不超出容器</p>
  </div>

  <!-- Case 6: Breadcrumb-like inline path -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">6. 面包屑路径</h3>
    <div style="font-size: 14px; line-height: 20px;">
      <span style="color: #202124;">www.example.com</span><span style="color: #70757a;"> › </span><span style="color: #70757a;">文档</span><span style="color: #70757a;"> › </span><span style="color: #70757a;">API 参考</span><span style="color: #70757a;"> › </span><span style="color: #70757a;">入门指南</span>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：所有 span 同行排列，间隔符"›"正确显示</p>
  </div>
</div>`
  },
  {
    name: '🌟🌟 [Layout] Margin Wrapper & Spacing',
    description: 'Test margin handling, margin collapse, and wrapper overhead',
    category: 'layout',
    html: `<div style="width: 600px; padding: 30px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333; font-size: 24px;">Margin Wrapper & 间距测试</h2>

  <!-- Case 1: Vertical margin collapse -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">1. 垂直 Margin 折叠</h3>
    <div style="background: #e8f0fe; padding: 8px;">
      <p style="margin: 20px 0; font-size: 14px; color: #333;">第一段（margin: 20px 0）</p>
      <p style="margin: 20px 0; font-size: 14px; color: #333;">第二段（margin: 20px 0）</p>
      <p style="margin: 30px 0; font-size: 14px; color: #333;">第三段（margin: 30px 0）</p>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：段间距折叠 — 1-2间20px，2-3间30px（取大值）</p>
  </div>

  <!-- Case 2: Margin on flex children -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">2. Flex 子元素 Margin</h3>
    <div style="display: flex; background: #e8f0fe; padding: 8px;">
      <div style="width: 80px; height: 60px; background: #1e80ff; margin-right: 16px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">mr:16</div>
      <div style="width: 80px; height: 60px; background: #ff6b6b; margin: 0 8px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">mx:8</div>
      <div style="width: 80px; height: 60px; background: #00b96b; margin-left: 16px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">ml:16</div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：Flex 子元素 margin 不折叠，间距正确</p>
  </div>

  <!-- Case 3: Negative margin (comprehensive) -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">3. 负 Margin 拉动</h3>

    <!-- 3a: Block layout, margin-top negative -->
    <p style="margin: 0 0 6px 0; color: #666; font-size: 13px;">3a. Block 布局 — margin-top: -10px</p>
    <div style="background: #e8f0fe; padding: 16px;">
      <div style="width: 200px; height: 40px; background: #1e80ff; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">基准元素</div>
      <div style="width: 200px; height: 40px; background: rgba(255,107,107,0.8); border-radius: 4px; margin-top: -10px; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">margin-top: -10px</div>
    </div>
    <p style="margin: 4px 0 12px 0; color: #999; font-size: 12px;">✅ 预期：红色元素上移 10px，部分重叠蓝色元素底部</p>

    <!-- 3b: Block layout, margin-top negative with content after -->
    <p style="margin: 0 0 6px 0; color: #666; font-size: 13px;">3b. Block 布局 — 负 margin 后有兄弟元素</p>
    <div style="background: #e8f0fe; padding: 16px;">
      <div style="width: 200px; height: 40px; background: #1e80ff; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">A</div>
      <div style="width: 200px; height: 40px; background: rgba(255,107,107,0.8); border-radius: 4px; margin-top: -15px; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">B: mt -15px</div>
      <div style="width: 200px; height: 40px; background: #00b96b; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">C: 紧跟 B</div>
    </div>
    <p style="margin: 4px 0 12px 0; color: #999; font-size: 12px;">✅ 预期：B 上移 15px 与 A 重叠，C 紧跟 B 下方（不塌陷）</p>

    <!-- 3c: Flex layout, negative margin-left -->
    <p style="margin: 0 0 6px 0; color: #666; font-size: 13px;">3c. Flex 布局 — margin-left: -20px</p>
    <div style="display: flex; background: #e8f0fe; padding: 16px; align-items: center;">
      <div style="width: 100px; height: 40px; background: #1e80ff; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">左</div>
      <div style="width: 100px; height: 40px; background: rgba(255,107,107,0.8); border-radius: 4px; margin-left: -20px; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">ml: -20</div>
      <div style="width: 100px; height: 40px; background: #00b96b; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">右</div>
    </div>
    <p style="margin: 4px 0 12px 0; color: #999; font-size: 12px;">✅ 预期：红色左移 20px 与蓝色重叠，绿色紧跟红色</p>

    <!-- 3d: Large negative margin (> element height) -->
    <p style="margin: 0 0 6px 0; color: #666; font-size: 13px;">3d. 负 margin 超过元素高度 — margin-top: -50px (元素高 40px)</p>
    <div style="background: #e8f0fe; padding: 16px;">
      <div style="width: 200px; height: 40px; background: #1e80ff; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">基准</div>
      <div style="width: 200px; height: 40px; background: rgba(255,107,107,0.8); border-radius: 4px; margin-top: -50px; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">mt: -50px</div>
    </div>
    <p style="margin: 4px 0 0 0; color: #999; font-size: 12px;">✅ 预期：红色完全覆盖蓝色并再上移 10px，容器高度缩小</p>
  </div>

  <!-- Case 4: Empty divs with only margin (spacers) -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">4. 纯间距空容器</h3>
    <div style="background: #e8f0fe; padding: 8px;">
      <div style="font-size: 14px; color: #333;">上方内容</div>
      <div style="height: 0; margin: 20px 0;"></div>
      <div style="font-size: 14px; color: #333;">下方内容</div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：空 div 的 margin 产生 20px 间距，不生成可见节点</p>
  </div>

  <!-- Case 5: Margin wrapper overflow (margin-wrapper taller than parent) -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">5. Margin 导致子元素溢出</h3>
    <div style="display: flex; align-items: center; height: 50px; background: #e8f0fe; padding: 0 8px; overflow: hidden;">
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%234285f4'/%3E%3C/svg%3E" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 12px;" />
      <div>
        <div style="font-size: 14px; color: #202124; margin-bottom: 4px;">标题文字</div>
        <div style="font-size: 12px; color: #70757a;">www.example.com › path</div>
      </div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：内容不超出 50px 高的容器，margin 不导致溢出</p>
  </div>
</div>`
  },
  {
    name: '🌟🌟 [Layout] Empty & Invisible Elements',
    description: 'Test handling of empty divs, hidden elements, 0-height containers',
    category: 'layout',
    html: `<div style="width: 600px; padding: 30px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333; font-size: 24px;">空元素 & 不可见元素测试</h2>

  <!-- Case 1: Empty inline-group-producing elements -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">1. 空白内联元素</h3>
    <div>
      <span></span>
      <span style="display: inline;"></span>
      <p style="margin: 0; font-size: 14px; color: #333;">这行上方有两个空 span，不应产生可见节点。</p>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：空 span 不生成 1x1 的 inline-group</p>
  </div>

  <!-- Case 2: visibility: hidden vs display: none -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">2. visibility:hidden vs display:none</h3>
    <div style="display: flex; gap: 12px; align-items: center;">
      <div style="width: 60px; height: 40px; background: #1e80ff; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">可见</div>
      <div style="width: 60px; height: 40px; background: #ff6b6b; border-radius: 4px; visibility: hidden; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">hidden</div>
      <div style="width: 60px; height: 40px; background: #00b96b; border-radius: 4px; display: none; align-items: center; justify-content: center; color: white; font-size: 12px;">none</div>
      <div style="width: 60px; height: 40px; background: #722ed1; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">可见</div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：hidden 占位但不可见，none 不占位，间距保持</p>
  </div>

  <!-- Case 3: opacity: 0 element -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">3. opacity: 0 元素</h3>
    <div style="display: flex; gap: 12px; align-items: center;">
      <div style="width: 60px; height: 40px; background: #1e80ff; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">1</div>
      <div style="width: 60px; height: 40px; background: #ff6b6b; border-radius: 4px; opacity: 0; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">隐藏</div>
      <div style="width: 60px; height: 40px; background: #00b96b; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">3</div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：opacity:0 占位，与 visible 元素间距不变</p>
  </div>

  <!-- Case 4: 0-height separator divs -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">4. 0 高度分隔线</h3>
    <div style="background: #e8f0fe; padding: 12px;">
      <div style="font-size: 14px; color: #333;">上方内容</div>
      <div style="height: 0; border-bottom: 1px solid #dadce0; margin: 12px 0;"></div>
      <div style="font-size: 14px; color: #333;">下方内容</div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：1px 分隔线可见，上下间距 12px</p>
  </div>

  <!-- Case 5: Pseudo-element only containers -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">5. 只有 padding 的空容器</h3>
    <div style="display: flex; gap: 12px;">
      <div style="padding: 20px; background: #e8f0fe; border-radius: 4px;"></div>
      <div style="width: 80px; height: 60px; padding: 10px; background: #fce8e6; border-radius: 4px;"></div>
      <div style="font-size: 14px; color: #333; display: flex; align-items: center;">这些是有 padding 但无内容的空盒子</div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：空盒子保留背景和 padding 尺寸</p>
  </div>

  <!-- Case 6: Offscreen / negative position elements -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">6. 屏幕外元素</h3>
    <div style="position: relative; height: 60px; background: #e8f0fe; border-radius: 4px; overflow: hidden;">
      <div style="position: absolute; left: -9999px; top: 0; font-size: 14px;">跳转到主内容</div>
      <div style="position: absolute; left: 10px; top: 10px; font-size: 14px; color: #333;">这是页面可见内容</div>
      <div style="position: absolute; left: 300px; top: -100px; width: 100px; height: 40px; background: #ff6b6b; border-radius: 4px;"></div>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：left:-9999px 和 top:-100px 的元素不应生成可见节点</p>
  </div>
</div>`
  },
  {
    name: '[Components] Table - Basic',
    description: 'Simple table with thead/tbody, borders, and alignment',
    category: 'components',
    html: `<div style="width: 600px; padding: 20px; font-family: Arial, sans-serif; background: #f9f9f9;">
  <h3 style="margin: 0 0 16px 0; color: #333;">Basic Table</h3>
  <table style="width: 100%; border-collapse: collapse; background: white;">
    <thead>
      <tr style="background: #4a90d9; color: white;">
        <th style="padding: 12px 16px; text-align: left; border: 1px solid #3a7bc8;">Name</th>
        <th style="padding: 12px 16px; text-align: left; border: 1px solid #3a7bc8;">Role</th>
        <th style="padding: 12px 16px; text-align: right; border: 1px solid #3a7bc8;">Score</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding: 10px 16px; border: 1px solid #e0e0e0;">Alice</td>
        <td style="padding: 10px 16px; border: 1px solid #e0e0e0;">Engineer</td>
        <td style="padding: 10px 16px; border: 1px solid #e0e0e0; text-align: right;">95</td>
      </tr>
      <tr style="background: #f5f5f5;">
        <td style="padding: 10px 16px; border: 1px solid #e0e0e0;">Bob</td>
        <td style="padding: 10px 16px; border: 1px solid #e0e0e0;">Designer</td>
        <td style="padding: 10px 16px; border: 1px solid #e0e0e0; text-align: right;">88</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; border: 1px solid #e0e0e0;">Charlie</td>
        <td style="padding: 10px 16px; border: 1px solid #e0e0e0;">Manager</td>
        <td style="padding: 10px 16px; border: 1px solid #e0e0e0; text-align: right;">92</td>
      </tr>
    </tbody>
  </table>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：表格有行列结构的 Auto Layout，表头蓝色背景，交替行背景色</p>
</div>`
  },
  {
    name: '[Components] Table - Complex',
    description: 'Table with colspan, rowspan, vertical-align, and border-spacing',
    category: 'components',
    html: `<div style="width: 600px; padding: 20px; font-family: Arial, sans-serif; background: #f9f9f9;">
  <h3 style="margin: 0 0 16px 0; color: #333;">Complex Table (colspan/rowspan)</h3>
  <table style="width: 100%; border-spacing: 4px; background: #ddd;">
    <tr>
      <td style="padding: 10px; background: white; vertical-align: top;">Top aligned</td>
      <td colspan="2" style="padding: 10px; background: #e8f4fd; text-align: center;">Colspan = 2</td>
    </tr>
    <tr>
      <td rowspan="2" style="padding: 10px; background: #fde8e8; vertical-align: middle;">Rowspan = 2<br>(middle aligned)</td>
      <td style="padding: 10px; background: white; vertical-align: bottom;">Bottom aligned</td>
      <td style="padding: 10px; background: white;">Normal cell</td>
    </tr>
    <tr>
      <td style="padding: 10px; background: white;">Cell below rowspan</td>
      <td style="padding: 10px; background: white;">Another cell</td>
    </tr>
  </table>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：colspan/rowspan 表格用绝对定位 fallback，border-spacing 4px 间距可见</p>
</div>`
  },
  {
    name: '[Components] List - Unordered & Ordered',
    description: 'Lists with markers, nesting, and different list-style-types',
    category: 'components',
    html: `<div style="width: 500px; padding: 20px; font-family: Arial, sans-serif; background: #f9f9f9;">
  <h3 style="margin: 0 0 16px 0; color: #333;">Unordered List (disc)</h3>
  <ul style="margin: 0 0 20px 0; padding-left: 24px; color: #333;">
    <li style="margin-bottom: 6px;">First item</li>
    <li style="margin-bottom: 6px;">Second item</li>
    <li style="margin-bottom: 6px;">Third item with longer text that may wrap to the next line</li>
  </ul>

  <h3 style="margin: 0 0 16px 0; color: #333;">Ordered List (decimal)</h3>
  <ol style="margin: 0 0 20px 0; padding-left: 24px; color: #333;">
    <li style="margin-bottom: 6px;">Step one</li>
    <li style="margin-bottom: 6px;">Step two</li>
    <li style="margin-bottom: 6px;">Step three</li>
  </ol>

  <h3 style="margin: 0 0 16px 0; color: #333;">Nested List</h3>
  <ul style="margin: 0 0 20px 0; padding-left: 24px; color: #333;">
    <li style="margin-bottom: 6px;">Parent item 1
      <ul style="margin: 6px 0 0 0; padding-left: 20px; list-style-type: circle;">
        <li style="margin-bottom: 4px;">Child item A</li>
        <li style="margin-bottom: 4px;">Child item B</li>
      </ul>
    </li>
    <li style="margin-bottom: 6px;">Parent item 2
      <ul style="margin: 6px 0 0 0; padding-left: 20px; list-style-type: square;">
        <li style="margin-bottom: 4px;">Child item C</li>
        <li style="margin-bottom: 4px;">Child item D</li>
      </ul>
    </li>
  </ul>

  <h3 style="margin: 0 0 16px 0; color: #333;">Different List Styles</h3>
  <div style="display: flex; gap: 40px;">
    <ol style="margin: 0; padding-left: 24px; list-style-type: lower-alpha; color: #333;">
      <li>Alpha one</li>
      <li>Alpha two</li>
      <li>Alpha three</li>
    </ol>
    <ol style="margin: 0; padding-left: 30px; list-style-type: upper-roman; color: #333;">
      <li>Roman one</li>
      <li>Roman two</li>
      <li>Roman three</li>
    </ol>
  </div>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：圆点/数字/字母标记可见，嵌套列表正确缩进</p>
</div>`
  },
  {
    name: '[Components] Semantic HTML Elements',
    description: 'hr, fieldset/legend, details/summary, dl/dt/dd semantic elements',
    category: 'components',
    html: `<div style="width: 500px; padding: 20px; font-family: Arial, sans-serif; background: #f9f9f9;">
  <h3 style="margin: 0 0 16px 0; color: #333;">Horizontal Rules</h3>
  <p style="margin: 0 0 8px 0; color: #333;">Content above the line</p>
  <hr style="border: none; border-top: 1px solid #ccc; margin: 8px 0;">
  <p style="margin: 8px 0 0 0; color: #333;">Content below the thin line</p>
  <hr style="border: none; border-top: 3px solid #4a90d9; margin: 16px 0;">
  <p style="margin: 0 0 20px 0; color: #333;">Content below the thick blue line</p>

  <h3 style="margin: 0 0 16px 0; color: #333;">Fieldset & Legend</h3>
  <fieldset style="border: 2px solid #4a90d9; border-radius: 8px; padding: 16px; margin: 0 0 20px 0;">
    <legend style="padding: 0 8px; color: #4a90d9; font-weight: bold;">User Information</legend>
    <div style="margin-bottom: 12px;">
      <label style="display: block; margin-bottom: 4px; color: #666; font-size: 14px;">Name</label>
      <input type="text" value="John Doe" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-size: 14px;">
    </div>
    <div>
      <label style="display: block; margin-bottom: 4px; color: #666; font-size: 14px;">Email</label>
      <input type="text" value="john@example.com" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-size: 14px;">
    </div>
  </fieldset>

  <h3 style="margin: 0 0 16px 0; color: #333;">Definition List</h3>
  <dl style="margin: 0 0 20px 0; color: #333;">
    <dt style="font-weight: bold; margin-bottom: 4px;">HTML</dt>
    <dd style="margin: 0 0 12px 20px; color: #666;">HyperText Markup Language - the standard markup language for web pages.</dd>
    <dt style="font-weight: bold; margin-bottom: 4px;">CSS</dt>
    <dd style="margin: 0 0 12px 20px; color: #666;">Cascading Style Sheets - a style sheet language for describing presentation.</dd>
    <dt style="font-weight: bold; margin-bottom: 4px;">JavaScript</dt>
    <dd style="margin: 0 0 0 20px; color: #666;">A programming language that enables interactive web pages.</dd>
  </dl>

  <h3 style="margin: 0 0 16px 0; color: #333;">Details & Summary</h3>
  <details open style="border: 1px solid #ddd; border-radius: 4px; padding: 12px; margin-bottom: 8px; background: white;">
    <summary style="cursor: pointer; font-weight: bold; color: #333;">Click to expand (opened)</summary>
    <p style="margin: 8px 0 0 0; color: #666;">This is the expanded content of the details element.</p>
  </details>
  <details style="border: 1px solid #ddd; border-radius: 4px; padding: 12px; background: white;">
    <summary style="cursor: pointer; font-weight: bold; color: #333;">Click to expand (closed)</summary>
    <p style="margin: 8px 0 0 0; color: #666;">This content is hidden when collapsed.</p>
  </details>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：hr 细线可见，fieldset 有边框和 legend，dl 定义列表缩进正确</p>
</div>`
  },
  // ==================== Pipeline Regression Tests ====================
  {
    name: '[Advanced] CSS Gradient Border',
    description: 'CSS渐变边框：transparent border + background-clip trick',
    category: 'advanced',
    html: `<div style="width: 600px; padding: 40px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333;">CSS Gradient Border</h2>

  <div style="margin-bottom: 20px; padding: 20px; border: 3px solid transparent; border-radius: 12px; background: linear-gradient(white, white) padding-box, linear-gradient(135deg, #667eea, #764ba2) border-box; background-clip: padding-box, border-box;">
    <p style="margin: 0; color: #333;">线性渐变边框（紫→蓝）</p>
  </div>

  <div style="margin-bottom: 20px; padding: 20px; border: 4px solid transparent; border-radius: 16px; background: linear-gradient(#fff, #fff) padding-box, linear-gradient(90deg, #ff0000, #ff7700, #ffff00, #00ff00, #0000ff) border-box; background-clip: padding-box, border-box;">
    <p style="margin: 0; color: #333;">彩虹渐变边框</p>
  </div>

  <div style="margin-bottom: 20px; padding: 20px; border: 3px solid #667eea; border-radius: 12px; background: white;">
    <p style="margin: 0; color: #333;">对照：普通实线边框</p>
  </div>

  <div style="padding: 20px; border: 6px solid transparent; border-radius: 20px; background: linear-gradient(#1a1a2e, #1a1a2e) padding-box, linear-gradient(45deg, #00d2ff, #3a7bd5) border-box; background-clip: padding-box, border-box;">
    <p style="margin: 0; color: #eee;">粗渐变边框 + 深色背景</p>
  </div>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：渐变边框清晰可见，fill 不覆盖边框区域，对照组为实线边框</p>
</div>`
  },
  {
    name: '[Advanced] Box Shadow Transparency',
    description: 'box-shadow 不应穿透到子元素（showShadowBehindNode）',
    category: 'advanced',
    html: `<div style="width: 500px; padding: 40px; background: #f0f0f0; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333;">Box Shadow + 透明区域</h2>

  <div style="margin-bottom: 30px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); border-radius: 12px;">
    <div style="background: white; padding: 15px; border-radius: 8px;">
      <p style="margin: 0; color: #333;">Shadow 不应出现在此子区域内</p>
    </div>
  </div>

  <div style="padding: 20px; background: white; box-shadow: 0 8px 24px rgba(0,0,0,0.3); border-radius: 12px;">
    <p style="margin: 0; color: #333;">对照：不透明容器上的正常 shadow</p>
  </div>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：第一个容器的 shadow 不穿透子元素，第二个正常显示</p>
</div>`
  },
  {
    name: '[Layout] HUG vs FIXED Height',
    description: '容器 HUG 坍缩场景：absolute children、零高度 children',
    category: 'layout',
    html: `<div style="width: 500px; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333;">HUG → FIXED 边界情况</h2>

  <div style="position: relative; height: 120px; background: #e0e7ff; margin-bottom: 20px; border-radius: 8px;">
    <div style="position: absolute; top: 10px; left: 10px; padding: 8px; background: #818cf8; color: white; border-radius: 4px;">Absolute child 1</div>
    <div style="position: absolute; bottom: 10px; right: 10px; padding: 8px; background: #6366f1; color: white; border-radius: 4px;">Absolute child 2</div>
  </div>

  <div style="height: 80px; background: #fef3c7; margin-bottom: 20px; padding: 10px; border-radius: 8px;">
    <div style="height: 0; overflow: hidden;">Hidden</div>
  </div>

  <div style="height: 60px; background: #dcfce7; border-radius: 8px;"></div>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：三个容器保持 browser 计算高度（120/80/60px），不坍缩</p>
</div>`
  },
  {
    name: '[Layout] Baseline Alignment',
    description: 'align-items: baseline 同高 vs 异高 children',
    category: 'layout',
    html: `<div style="width: 600px; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333;">Baseline Alignment</h2>

  <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">同高 children（应居中对齐）</p>
  <div style="display: flex; align-items: baseline; gap: 10px; height: 80px; background: #e0e7ff; padding: 0 10px; margin-bottom: 20px; border-radius: 8px;">
    <div style="padding: 8px 16px; background: #818cf8; color: white; border-radius: 4px; font-size: 16px;">Same</div>
    <div style="padding: 8px 16px; background: #6366f1; color: white; border-radius: 4px; font-size: 16px;">Height</div>
    <div style="padding: 8px 16px; background: #4f46e5; color: white; border-radius: 4px; font-size: 16px;">Items</div>
  </div>

  <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">异高 children（文字基线对齐）</p>
  <div style="display: flex; align-items: baseline; gap: 10px; height: 100px; background: #fef3c7; padding: 0 10px; border-radius: 8px;">
    <div style="padding: 4px 12px; background: #f59e0b; color: white; border-radius: 4px; font-size: 12px;">Small</div>
    <div style="padding: 12px 16px; background: #d97706; color: white; border-radius: 4px; font-size: 24px;">Medium</div>
    <div style="padding: 20px 20px; background: #b45309; color: white; border-radius: 4px; font-size: 36px;">Large</div>
  </div>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：同高居中，异高基线对齐</p>
</div>`
  },
  {
    name: '[Layout] Flex Basis Zero',
    description: 'flex-basis: 0 + flex-grow: 0 不应坍缩',
    category: 'layout',
    html: `<div style="width: 500px; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333;">flex-basis: 0</h2>

  <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">basis=0, grow=0（应使用元素自身宽度）</p>
  <div style="display: flex; gap: 10px; background: #e0e7ff; padding: 10px; margin-bottom: 20px; border-radius: 8px;">
    <div style="flex: 0 0 0px; width: 100px; padding: 10px; background: #818cf8; color: white; border-radius: 4px;">w=100px</div>
    <div style="flex: 0 0 0px; width: 150px; padding: 10px; background: #6366f1; color: white; border-radius: 4px;">w=150px</div>
  </div>

  <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">basis=0, grow=1（均分空间）</p>
  <div style="display: flex; gap: 10px; background: #dcfce7; padding: 10px; margin-bottom: 20px; border-radius: 8px;">
    <div style="flex: 1 0 0px; padding: 10px; background: #22c55e; color: white; border-radius: 4px;">grow=1</div>
    <div style="flex: 1 0 0px; padding: 10px; background: #16a34a; color: white; border-radius: 4px;">grow=1</div>
  </div>

  <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">basis=200px（对照）</p>
  <div style="display: flex; gap: 10px; background: #fef3c7; padding: 10px; border-radius: 8px;">
    <div style="flex: 0 0 200px; padding: 10px; background: #f59e0b; color: white; border-radius: 4px;">basis=200px</div>
    <div style="flex: 0 0 100px; padding: 10px; background: #d97706; color: white; border-radius: 4px;">basis=100px</div>
  </div>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：第一组不坍缩，第二组均分，第三组固定宽度</p>
</div>`
  },
  {
    name: '[Advanced] Z-Index Flow Placeholder',
    description: 'z-index 提升后保留流式占位，防止后续元素坍缩',
    category: 'advanced',
    html: `<div style="width: 400px; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333;">Z-Index Placeholder</h2>

  <div style="background: white; padding: 10px; border-radius: 8px;">
    <div style="padding: 10px; background: #e0e7ff; margin-bottom: 10px;">Before (flow)</div>
    <div style="position: relative; z-index: 10; padding: 10px; background: #fca5a5; margin-bottom: 10px;">Promoted (z-index: 10)</div>
    <div style="padding: 10px; background: #bbf7d0;">After（不应上移）</div>
  </div>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：三个块垂直排列，中间的 z-index 提升后空间不消失</p>
</div>`
  },
  {
    name: '[Layout] Zero-Height Element Spacing',
    description: '零高度元素间距延迟到下一个有内容的 sibling',
    category: 'layout',
    html: `<div style="width: 400px; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333;">零高度间距延迟</h2>

  <div style="background: white; padding: 10px; border-radius: 8px;">
    <div style="padding: 10px; background: #e0e7ff; margin-bottom: 20px;">First block</div>
    <div style="height: 0; overflow: hidden; margin-bottom: 15px;"></div>
    <div style="padding: 10px; background: #dcfce7; margin-bottom: 20px;">After zero-height（间距保持）</div>
    <hr style="border: none; height: 0; margin: 10px 0;">
    <div style="padding: 10px; background: #fef3c7;">After hr（间距保持）</div>
  </div>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：间距正确传递，不产生空气盒子</p>
</div>`
  },
  {
    name: '[Layout] Flex Center + Cross-Axis Margin',
    description: 'align-items: center 时 cross-axis margin 不破坏居中',
    category: 'layout',
    html: `<div style="width: 500px; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 20px 0; color: #333;">Flex Center + Cross-Axis Margin</h2>

  <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">center 对齐（cross-axis margin 不应影响居中）</p>
  <div style="display: flex; align-items: center; height: 120px; gap: 10px; background: #e0e7ff; padding: 0 10px; margin-bottom: 20px; border-radius: 8px;">
    <div style="margin-top: 20px; margin-bottom: 10px; padding: 10px; background: #818cf8; color: white; border-radius: 4px;">mt=20 mb=10</div>
    <div style="margin-top: 5px; padding: 10px; background: #6366f1; color: white; border-radius: 4px;">mt=5</div>
    <div style="padding: 10px; background: #4f46e5; color: white; border-radius: 4px;">No margin</div>
  </div>

  <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">flex-start 对齐（对照）</p>
  <div style="display: flex; align-items: flex-start; height: 120px; gap: 10px; background: #fef3c7; padding: 0 10px; border-radius: 8px;">
    <div style="margin-top: 20px; margin-bottom: 10px; padding: 10px; background: #f59e0b; color: white; border-radius: 4px;">mt=20 mb=10</div>
    <div style="margin-top: 5px; padding: 10px; background: #d97706; color: white; border-radius: 4px;">mt=5</div>
    <div style="padding: 10px; background: #b45309; color: white; border-radius: 4px;">No margin</div>
  </div>
  <p style="margin: 12px 0 0 0; color: #999; font-size: 12px;">✅ 预期：center 组三个元素视觉居中对齐，flex-start 组顶部对齐 + margin 偏移</p>
  <h2 style="margin: 0 0 20px 0; color: #333;">HTML Table 渲染测试</h2>

  <!-- Case 1: Basic table with borders -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">1. 基础表格 (border-collapse: collapse)</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <thead>
        <tr>
          <th style="border: 1px solid #ddd; padding: 10px 12px; background: #f8f9fa; text-align: left; font-weight: 600; color: #333;">姓名</th>
          <th style="border: 1px solid #ddd; padding: 10px 12px; background: #f8f9fa; text-align: left; font-weight: 600; color: #333;">职位</th>
          <th style="border: 1px solid #ddd; padding: 10px 12px; background: #f8f9fa; text-align: center; font-weight: 600; color: #333;">状态</th>
          <th style="border: 1px solid #ddd; padding: 10px 12px; background: #f8f9fa; text-align: right; font-weight: 600; color: #333;">薪资</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border: 1px solid #ddd; padding: 10px 12px; color: #333;">张三</td>
          <td style="border: 1px solid #ddd; padding: 10px 12px; color: #666;">前端工程师</td>
          <td style="border: 1px solid #ddd; padding: 10px 12px; text-align: center;"><span style="background: #e8f5e9; color: #2e7d32; padding: 2px 8px; border-radius: 10px; font-size: 12px;">在职</span></td>
          <td style="border: 1px solid #ddd; padding: 10px 12px; text-align: right; color: #333;">¥25,000</td>
        </tr>
        <tr style="background: #fafafa;">
          <td style="border: 1px solid #ddd; padding: 10px 12px; color: #333;">李四</td>
          <td style="border: 1px solid #ddd; padding: 10px 12px; color: #666;">UI 设计师</td>
          <td style="border: 1px solid #ddd; padding: 10px 12px; text-align: center;"><span style="background: #fff3e0; color: #e65100; padding: 2px 8px; border-radius: 10px; font-size: 12px;">休假</span></td>
          <td style="border: 1px solid #ddd; padding: 10px 12px; text-align: right; color: #333;">¥22,000</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 10px 12px; color: #333;">王五</td>
          <td style="border: 1px solid #ddd; padding: 10px 12px; color: #666;">后端工程师</td>
          <td style="border: 1px solid #ddd; padding: 10px 12px; text-align: center;"><span style="background: #e8f5e9; color: #2e7d32; padding: 2px 8px; border-radius: 10px; font-size: 12px;">在职</span></td>
          <td style="border: 1px solid #ddd; padding: 10px 12px; text-align: right; color: #333;">¥28,000</td>
        </tr>
      </tbody>
    </table>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：单元格水平排列，列宽对齐，表头灰底加粗，状态标签居中</p>
  </div>

  <!-- Case 2: Vertical alignment in cells -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">2. 单元格垂直对齐 (vertical-align)</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr>
        <td style="border: 1px solid #ddd; padding: 12px; height: 80px; vertical-align: top; background: #fff8e1; color: #333;">
          <strong>top</strong><br>顶部对齐
        </td>
        <td style="border: 1px solid #ddd; padding: 12px; height: 80px; vertical-align: middle; background: #e8f5e9; color: #333;">
          <strong>middle</strong><br>居中对齐
        </td>
        <td style="border: 1px solid #ddd; padding: 12px; height: 80px; vertical-align: bottom; background: #e3f2fd; color: #333;">
          <strong>bottom</strong><br>底部对齐
        </td>
      </tr>
    </table>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：三列分别顶部、居中、底部对齐内容</p>
  </div>

  <!-- Case 3: Border-spacing (separate borders) -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">3. 分离边框 + 间距 (border-spacing)</h3>
    <table style="width: 100%; border-collapse: separate; border-spacing: 8px; font-size: 14px;">
      <tr>
        <td style="border: 2px solid #1976d2; border-radius: 6px; padding: 12px; background: #e3f2fd; color: #333;">单元格 A</td>
        <td style="border: 2px solid #388e3c; border-radius: 6px; padding: 12px; background: #e8f5e9; color: #333;">单元格 B</td>
        <td style="border: 2px solid #f57c00; border-radius: 6px; padding: 12px; background: #fff3e0; color: #333;">单元格 C</td>
      </tr>
      <tr>
        <td style="border: 2px solid #7b1fa2; border-radius: 6px; padding: 12px; background: #f3e5f5; color: #333;">单元格 D</td>
        <td style="border: 2px solid #c62828; border-radius: 6px; padding: 12px; background: #ffebee; color: #333;">单元格 E</td>
        <td style="border: 2px solid #00695c; border-radius: 6px; padding: 12px; background: #e0f2f1; color: #333;">单元格 F</td>
      </tr>
    </table>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：单元格间有 8px 间距，各自带圆角和不同颜色边框</p>
  </div>

  <!-- Case 4: Table caption -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">4. 表格标题 (caption) + 紧凑表格</h3>
    <table style="width: 60%; border-collapse: collapse; font-size: 13px; margin: 0 auto;">
      <caption style="caption-side: top; padding: 8px; font-weight: 600; color: #555; font-size: 14px;">季度销售数据</caption>
      <thead>
        <tr>
          <th style="border: 1px solid #ccc; padding: 6px 10px; background: #eee; text-align: center;">Q1</th>
          <th style="border: 1px solid #ccc; padding: 6px 10px; background: #eee; text-align: center;">Q2</th>
          <th style="border: 1px solid #ccc; padding: 6px 10px; background: #eee; text-align: center;">Q3</th>
          <th style="border: 1px solid #ccc; padding: 6px 10px; background: #eee; text-align: center;">Q4</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border: 1px solid #ccc; padding: 6px 10px; text-align: center; color: #333;">¥120万</td>
          <td style="border: 1px solid #ccc; padding: 6px 10px; text-align: center; color: #333;">¥156万</td>
          <td style="border: 1px solid #ccc; padding: 6px 10px; text-align: center; color: #2e7d32; font-weight: 600;">¥203万</td>
          <td style="border: 1px solid #ccc; padding: 6px 10px; text-align: center; color: #333;">¥189万</td>
        </tr>
      </tbody>
    </table>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：居中表格，上方有标题，数据单元格文字居中</p>
  </div>

  <!-- Case 5: Nested content in cells -->
  <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">5. 嵌套内容单元格</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr>
        <td style="border: 1px solid #ddd; padding: 12px; width: 60px; vertical-align: middle;">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: #1976d2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px;">A</div>
        </td>
        <td style="border: 1px solid #ddd; padding: 12px; vertical-align: middle;">
          <div style="font-weight: 600; color: #333; margin-bottom: 2px;">Alice Wang</div>
          <div style="font-size: 12px; color: #888;">alice@example.com</div>
        </td>
        <td style="border: 1px solid #ddd; padding: 12px; text-align: right; vertical-align: middle;">
          <span style="background: #e8f5e9; color: #2e7d32; padding: 4px 12px; border-radius: 12px; font-size: 12px;">Admin</span>
        </td>
      </tr>
      <tr>
        <td style="border: 1px solid #ddd; padding: 12px; vertical-align: middle;">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: #e91e63; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px;">B</div>
        </td>
        <td style="border: 1px solid #ddd; padding: 12px; vertical-align: middle;">
          <div style="font-weight: 600; color: #333; margin-bottom: 2px;">Bob Zhang</div>
          <div style="font-size: 12px; color: #888;">bob@example.com</div>
        </td>
        <td style="border: 1px solid #ddd; padding: 12px; text-align: right; vertical-align: middle;">
          <span style="background: #e3f2fd; color: #1565c0; padding: 4px 12px; border-radius: 12px; font-size: 12px;">Member</span>
        </td>
      </tr>
    </table>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：头像圆形居中，文字垂直居中，标签右对齐</p>
  </div>
</div>`
  },
  {
    name: '🌟🌟🌟 [Layout] Complex Table Scenarios',
    description: 'Test pricing table, striped rows, status dashboard, and mini data grid',
    category: 'layout',
    html: `<div style="width: 850px; padding: 30px; font-family: Arial, sans-serif; background: #f5f5f5;">
  <h2 style="margin: 0 0 20px 0; color: #333;">复杂表格场景测试</h2>

  <!-- Case 1: Pricing comparison table -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">1. 定价对比表</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: center;">
      <thead>
        <tr>
          <th style="border: 1px solid #e0e0e0; padding: 12px; background: #fafafa; width: 30%;"></th>
          <th style="border: 1px solid #e0e0e0; padding: 12px; background: #fafafa; font-weight: 600; color: #333;">免费版</th>
          <th style="border: 2px solid #1976d2; padding: 12px; background: #e3f2fd; font-weight: 700; color: #1976d2;">专业版</th>
          <th style="border: 1px solid #e0e0e0; padding: 12px; background: #fafafa; font-weight: 600; color: #333;">企业版</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border: 1px solid #e0e0e0; padding: 10px; text-align: left; font-weight: 500; color: #333;">价格</td>
          <td style="border: 1px solid #e0e0e0; padding: 10px; color: #666;">¥0/月</td>
          <td style="border-left: 2px solid #1976d2; border-right: 2px solid #1976d2; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; padding: 10px; font-weight: 600; color: #1976d2;">¥99/月</td>
          <td style="border: 1px solid #e0e0e0; padding: 10px; color: #666;">¥299/月</td>
        </tr>
        <tr style="background: #f9f9f9;">
          <td style="border: 1px solid #e0e0e0; padding: 10px; text-align: left; font-weight: 500; color: #333;">存储空间</td>
          <td style="border: 1px solid #e0e0e0; padding: 10px; color: #666;">1 GB</td>
          <td style="border-left: 2px solid #1976d2; border-right: 2px solid #1976d2; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; padding: 10px; color: #333;">100 GB</td>
          <td style="border: 1px solid #e0e0e0; padding: 10px; color: #666;">无限</td>
        </tr>
        <tr>
          <td style="border: 1px solid #e0e0e0; padding: 10px; text-align: left; font-weight: 500; color: #333;">API 调用</td>
          <td style="border: 1px solid #e0e0e0; padding: 10px; color: #999;">100/天</td>
          <td style="border-left: 2px solid #1976d2; border-right: 2px solid #1976d2; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; padding: 10px; color: #333;">10,000/天</td>
          <td style="border: 1px solid #e0e0e0; padding: 10px; color: #666;">无限</td>
        </tr>
        <tr style="background: #f9f9f9;">
          <td style="border: 1px solid #e0e0e0; padding: 10px; text-align: left; font-weight: 500; color: #333;">技术支持</td>
          <td style="border: 1px solid #e0e0e0; padding: 10px; color: #999;">社区</td>
          <td style="border-left: 2px solid #1976d2; border-right: 2px solid #1976d2; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; padding: 10px; color: #333;">邮件 + 工单</td>
          <td style="border: 1px solid #e0e0e0; padding: 10px; color: #666;">专属客户经理</td>
        </tr>
      </tbody>
    </table>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：专业版列蓝色高亮边框，斑马纹行交替</p>
  </div>

  <!-- Case 2: Status dashboard table -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">2. 运维状态仪表盘表格</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="background: #263238; color: white;">
          <th style="padding: 10px 14px; text-align: left; font-weight: 500;">服务名称</th>
          <th style="padding: 10px 14px; text-align: center; font-weight: 500;">状态</th>
          <th style="padding: 10px 14px; text-align: right; font-weight: 500;">响应时间</th>
          <th style="padding: 10px 14px; text-align: right; font-weight: 500;">可用率</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 14px; color: #333; font-weight: 500;">API Gateway</td>
          <td style="padding: 10px 14px; text-align: center;"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4caf50; margin-right: 6px; vertical-align: middle;"></span><span style="color: #4caf50; font-size: 12px; vertical-align: middle;">正常</span></td>
          <td style="padding: 10px 14px; text-align: right; color: #666;">23ms</td>
          <td style="padding: 10px 14px; text-align: right;"><span style="color: #4caf50; font-weight: 600;">99.99%</span></td>
        </tr>
        <tr style="border-bottom: 1px solid #eee; background: #fafafa;">
          <td style="padding: 10px 14px; color: #333; font-weight: 500;">Database</td>
          <td style="padding: 10px 14px; text-align: center;"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ff9800; margin-right: 6px; vertical-align: middle;"></span><span style="color: #ff9800; font-size: 12px; vertical-align: middle;">告警</span></td>
          <td style="padding: 10px 14px; text-align: right; color: #ff9800; font-weight: 500;">156ms</td>
          <td style="padding: 10px 14px; text-align: right;"><span style="color: #ff9800; font-weight: 600;">98.50%</span></td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 14px; color: #333; font-weight: 500;">CDN</td>
          <td style="padding: 10px 14px; text-align: center;"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4caf50; margin-right: 6px; vertical-align: middle;"></span><span style="color: #4caf50; font-size: 12px; vertical-align: middle;">正常</span></td>
          <td style="padding: 10px 14px; text-align: right; color: #666;">8ms</td>
          <td style="padding: 10px 14px; text-align: right;"><span style="color: #4caf50; font-weight: 600;">99.95%</span></td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; color: #333; font-weight: 500;">Auth Service</td>
          <td style="padding: 10px 14px; text-align: center;"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #f44336; margin-right: 6px; vertical-align: middle;"></span><span style="color: #f44336; font-size: 12px; vertical-align: middle;">故障</span></td>
          <td style="padding: 10px 14px; text-align: right; color: #f44336; font-weight: 500;">超时</td>
          <td style="padding: 10px 14px; text-align: right;"><span style="color: #f44336; font-weight: 600;">85.20%</span></td>
        </tr>
      </tbody>
    </table>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：深色表头，状态圆点 + 文字，数值右对齐</p>
  </div>

  <!-- Case 3: Data grid with numbers -->
  <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">3. 紧凑数据网格</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 12px; font-family: 'Courier New', monospace;">
      <thead>
        <tr>
          <th style="border: 1px solid #ccc; padding: 6px 8px; background: #f0f0f0; text-align: left; color: #555;">指标</th>
          <th style="border: 1px solid #ccc; padding: 6px 8px; background: #f0f0f0; text-align: right; color: #555;">周一</th>
          <th style="border: 1px solid #ccc; padding: 6px 8px; background: #f0f0f0; text-align: right; color: #555;">周二</th>
          <th style="border: 1px solid #ccc; padding: 6px 8px; background: #f0f0f0; text-align: right; color: #555;">周三</th>
          <th style="border: 1px solid #ccc; padding: 6px 8px; background: #f0f0f0; text-align: right; color: #555;">周四</th>
          <th style="border: 1px solid #ccc; padding: 6px 8px; background: #f0f0f0; text-align: right; color: #555;">周五</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border: 1px solid #ccc; padding: 6px 8px; font-weight: 500; color: #333;">PV</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #333;">12,450</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #333;">13,220</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #4caf50;">15,800</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #333;">14,100</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #f44336;">9,350</td>
        </tr>
        <tr style="background: #fafafa;">
          <td style="border: 1px solid #ccc; padding: 6px 8px; font-weight: 500; color: #333;">UV</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #333;">3,210</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #333;">3,450</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #4caf50;">4,120</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #333;">3,800</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #f44336;">2,150</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ccc; padding: 6px 8px; font-weight: 500; color: #333;">转化率</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #333;">2.8%</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #333;">3.1%</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #4caf50;">3.5%</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #333;">3.0%</td>
          <td style="border: 1px solid #ccc; padding: 6px 8px; text-align: right; color: #f44336;">1.9%</td>
        </tr>
      </tbody>
    </table>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：等宽字体，数值右对齐，绿色=增长 红色=下降</p>
  </div>
</div>`
  },
  {
    name: '🌟🌟🌟 [Basic] List Markers & Semantic Tags',
    description: 'Test ul/ol list markers, dl/dt/dd, blockquote, hr, pre/code, details/summary',
    category: 'basic',
    html: `<div style="width: 700px; padding: 30px; font-family: Arial, sans-serif; background: #f5f5f5;">
  <h2 style="margin: 0 0 20px 0; color: #333;">列表标记 & 语义标签测试</h2>

  <!-- Case 1: Unordered lists -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">1. 无序列表 (ul/li) — disc/circle/square</h3>
    <ul style="margin: 0 0 12px 0; padding-left: 24px; color: #333; font-size: 14px; line-height: 1.8;">
      <li>默认 disc 项目符号（实心圆）</li>
      <li>第二个条目</li>
      <li style="font-weight: bold; color: #1976d2;">带样式的第三个条目</li>
    </ul>
    <ul style="margin: 0 0 12px 0; padding-left: 48px; list-style-type: circle; color: #555; font-size: 14px; line-height: 1.8;">
      <li>circle 空心圆</li>
      <li>嵌套缩进层级</li>
    </ul>
    <ul style="margin: 0; padding-left: 72px; list-style-type: square; color: #777; font-size: 14px; line-height: 1.8;">
      <li>square 实心方块</li>
      <li>最内层列表</li>
    </ul>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：三种标记符号可见 — • ◦ ▪</p>
  </div>

  <!-- Case 2: Ordered lists -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">2. 有序列表 (ol/li) — 多种编号</h3>
    <ol style="margin: 0 0 12px 0; padding-left: 30px; color: #333; font-size: 14px; line-height: 1.8;">
      <li>decimal 默认数字 (1.)</li>
      <li>第二项</li>
      <li>第三项</li>
    </ol>
    <ol style="margin: 0 0 12px 0; padding-left: 30px; list-style-type: lower-alpha; color: #333; font-size: 14px; line-height: 1.8;">
      <li>lower-alpha (a.)</li>
      <li>second item (b.)</li>
    </ol>
    <ol start="5" style="margin: 0 0 12px 0; padding-left: 30px; list-style-type: upper-roman; color: #333; font-size: 14px; line-height: 1.8;">
      <li>upper-roman start=5 (V.)</li>
      <li>next item (VI.)</li>
    </ol>
    <ol style="margin: 0; padding-left: 30px; list-style-type: cjk-decimal; color: #333; font-size: 14px; line-height: 1.8;">
      <li>CJK decimal (一、)</li>
      <li>第二项 (二、)</li>
      <li>第三项 (三、)</li>
    </ol>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：数字、字母、罗马、中文编号均可见</p>
  </div>

  <!-- Case 3: Definition list -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">3. 定义列表 (dl/dt/dd)</h3>
    <dl style="margin: 0; font-size: 14px; color: #333;">
      <dt style="font-weight: bold; margin-bottom: 4px;">HTML</dt>
      <dd style="margin: 0 0 12px 20px; color: #666;">HyperText Markup Language — 网页结构标记语言</dd>
      <dt style="font-weight: bold; margin-bottom: 4px;">CSS</dt>
      <dd style="margin: 0 0 12px 20px; color: #666;">Cascading Style Sheets — 层叠样式表</dd>
      <dt style="font-weight: bold; margin-bottom: 4px;">JavaScript</dt>
      <dd style="margin: 0 0 0 20px; color: #666;">动态脚本语言，用于实现网页交互</dd>
    </dl>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：术语加粗，定义缩进</p>
  </div>

  <!-- Case 4: Horizontal rule -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">4. 水平分割线 (hr)</h3>
    <p style="margin: 0 0 10px 0; font-size: 14px; color: #333;">上方内容</p>
    <hr style="border: none; border-top: 1px solid #ddd; margin: 10px 0;">
    <p style="margin: 10px 0 10px 0; font-size: 14px; color: #333;">两条分割线之间</p>
    <hr style="border: none; height: 3px; background: linear-gradient(to right, #1976d2, #e91e63); margin: 10px 0; border-radius: 2px;">
    <p style="margin: 10px 0 0 0; font-size: 14px; color: #333;">下方内容</p>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：两条分割线 — 1px灰线 + 3px渐变色线</p>
  </div>

  <!-- Case 5: Blockquote -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">5. 引用块 (blockquote)</h3>
    <blockquote style="margin: 0; padding: 12px 20px; border-left: 4px solid #1976d2; background: #f5f8ff; font-style: italic; color: #555; font-size: 14px; line-height: 1.6;">
      "优秀的设计是尽可能少的设计。" —— Dieter Rams
    </blockquote>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：左边蓝色竖线，浅蓝背景，斜体文字</p>
  </div>

  <!-- Case 6: Pre/Code -->
  <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">6. 代码块 (pre/code)</h3>
    <p style="margin: 0 0 8px 0; font-size: 14px; color: #333;">行内代码：使用 <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; font-size: 13px; color: #d63384;">npm install</code> 安装依赖</p>
    <pre style="margin: 0; padding: 16px; background: #1e1e1e; color: #d4d4d4; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.5; overflow-x: auto;"><code>function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10)); // 55</code></pre>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：代码块保留缩进和换行，深色背景，等宽字体</p>
  </div>

  <!-- Case 7: Details/Summary -->
  <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">7. 折叠面板 (details/summary)</h3>
    <details open style="border: 1px solid #ddd; border-radius: 6px; padding: 0; font-size: 14px;">
      <summary style="padding: 12px 16px; background: #f8f9fa; cursor: pointer; font-weight: 600; color: #333; border-bottom: 1px solid #ddd;">点击展开/折叠</summary>
      <div style="padding: 16px; color: #555; line-height: 1.6;">
        这是折叠内容区域。<code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-family: monospace; font-size: 13px;">&lt;details open&gt;</code> 默认展开。
      </div>
    </details>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">✅ 预期：summary 灰底加粗，内容区域正常显示</p>
  </div>
</div>`
  },
  {
    name: '[Components] Table - Spacing & Gaps',
    description: 'Table with border-spacing, border-collapse, row margins, vertical-align, and various gap patterns',
    category: 'components',
    html: `<div style="width: 700px; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
  <h2 style="margin: 0 0 16px 0; color: #333;">Table Spacing & Gap Tests</h2>

  <!-- 1. border-collapse: separate + border-spacing -->
  <h3 style="margin: 0 0 8px 0; color: #555; font-size: 14px;">1. border-spacing: 8px (separate)</h3>
  <table style="width: 100%; border-collapse: separate; border-spacing: 8px; font-size: 14px; margin-bottom: 20px;">
    <tbody>
      <tr>
        <td style="border: 2px solid #1976d2; border-radius: 6px; padding: 12px; background: #e3f2fd;">Cell A</td>
        <td style="border: 2px solid #388e3c; border-radius: 6px; padding: 12px; background: #e8f5e9;">Cell B</td>
        <td style="border: 2px solid #f57c00; border-radius: 6px; padding: 12px; background: #fff3e0;">Cell C</td>
      </tr>
      <tr>
        <td style="border: 2px solid #7b1fa2; border-radius: 6px; padding: 12px; background: #f3e5f5;">Cell D</td>
        <td style="border: 2px solid #c62828; border-radius: 6px; padding: 12px; background: #ffebee;">Cell E</td>
        <td style="border: 2px solid #00695c; border-radius: 6px; padding: 12px; background: #e0f2f1;">Cell F</td>
      </tr>
    </tbody>
  </table>
  <p style="margin: 0 0 20px 0; color: #999; font-size: 12px;">✅ 预期：单元格之间有 8px 间隙，圆角边框</p>

  <!-- 2. border-collapse: collapse -->
  <h3 style="margin: 0 0 8px 0; color: #555; font-size: 14px;">2. border-collapse: collapse</h3>
  <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
    <thead>
      <tr>
        <th style="border: 1px solid #ddd; padding: 10px; background: #f0f0f0; text-align: left;">Header 1</th>
        <th style="border: 1px solid #ddd; padding: 10px; background: #f0f0f0; text-align: left;">Header 2</th>
        <th style="border: 1px solid #ddd; padding: 10px; background: #f0f0f0; text-align: left;">Header 3</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border: 1px solid #ddd; padding: 10px;">Row 1 Col 1</td>
        <td style="border: 1px solid #ddd; padding: 10px;">Row 1 Col 2</td>
        <td style="border: 1px solid #ddd; padding: 10px;">Row 1 Col 3</td>
      </tr>
      <tr>
        <td style="border: 1px solid #ddd; padding: 10px;">Row 2 Col 1</td>
        <td style="border: 1px solid #ddd; padding: 10px;">Row 2 Col 2</td>
        <td style="border: 1px solid #ddd; padding: 10px;">Row 2 Col 3</td>
      </tr>
    </tbody>
  </table>
  <p style="margin: 0 0 20px 0; color: #999; font-size: 12px;">✅ 预期：无间隙，边框合并不重叠</p>

  <!-- 3. vertical-align -->
  <h3 style="margin: 0 0 8px 0; color: #555; font-size: 14px;">3. vertical-align (top / middle / bottom)</h3>
  <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
    <tbody>
      <tr>
        <td style="border: 1px solid #ddd; padding: 12px; height: 80px; vertical-align: top; background: #fff8e1;">
          <strong>top</strong><br>顶部对齐
        </td>
        <td style="border: 1px solid #ddd; padding: 12px; height: 80px; vertical-align: middle; background: #e8f5e9;">
          <strong>middle</strong><br>居中对齐
        </td>
        <td style="border: 1px solid #ddd; padding: 12px; height: 80px; vertical-align: bottom; background: #e3f2fd;">
          <strong>bottom</strong><br>底部对齐
        </td>
      </tr>
    </tbody>
  </table>
  <p style="margin: 0 0 20px 0; color: #999; font-size: 12px;">✅ 预期：三列内容分别顶部、居中、底部对齐</p>

  <!-- 4. Standalone tbody (no table wrapper) -->
  <h3 style="margin: 0 0 8px 0; color: #555; font-size: 14px;">4. 行间距测试 (模拟百度搜索结果)</h3>
  <table style="width: 100%; border-collapse: separate; border-spacing: 0 6px; font-size: 14px; margin-bottom: 20px;">
    <tbody>
      <tr>
        <td style="padding: 8px 12px; background: #fff; border-radius: 4px;"><a style="color: #1a0dab; text-decoration: none; padding-right: 12px;">为什么不继续挖三星堆</a></td>
        <td style="padding: 8px 12px; background: #fff; border-radius: 4px;"><a style="color: #1a0dab; text-decoration: none; padding-right: 12px;">三星堆鸟</a></td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; background: #fff; border-radius: 4px;"><a style="color: #1a0dab; text-decoration: none; padding-right: 12px;">三星堆的鸟叫什么名字</a></td>
        <td style="padding: 8px 12px; background: #fff; border-radius: 4px;"><a style="color: #1a0dab; text-decoration: none; padding-right: 12px;">三星堆怎么发现的</a></td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; background: #fff; border-radius: 4px;"><a style="color: #1a0dab; text-decoration: none; padding-right: 12px;">三星堆太阳神鸟金饰</a></td>
        <td style="padding: 8px 12px; background: #fff; border-radius: 4px;"><a style="color: #1a0dab; text-decoration: none; padding-right: 12px;">三星堆神树神鸟</a></td>
      </tr>
    </tbody>
  </table>
  <p style="margin: 0 0 20px 0; color: #999; font-size: 12px;">✅ 预期：行之间有 6px 间距，单元格有圆角白色背景</p>

  <!-- 5. Flex container with margins -->
  <h3 style="margin: 0 0 8px 0; color: #555; font-size: 14px;">5. Flex 子元素 margin</h3>
  <div style="display: flex; align-items: center; height: 80px; gap: 10px; background: #e0e7ff; padding: 0 10px; margin-bottom: 20px; border-radius: 8px;">
    <div style="margin-top: 15px; padding: 8px 12px; background: #818cf8; color: white; border-radius: 4px; font-size: 13px;">mt=15</div>
    <div style="margin-bottom: 10px; padding: 8px 12px; background: #6366f1; color: white; border-radius: 4px; font-size: 13px;">mb=10</div>
    <div style="margin-left: 20px; padding: 8px 12px; background: #4f46e5; color: white; border-radius: 4px; font-size: 13px;">ml=20</div>
    <div style="padding: 8px 12px; background: #3730a3; color: white; border-radius: 4px; font-size: 13px;">No margin</div>
  </div>
  <p style="margin: 0 0 20px 0; color: #999; font-size: 12px;">✅ 预期：margin 偏移各不相同，整体居中对齐</p>

  <!-- 6. Absolute positioning + constraints -->
  <h3 style="margin: 0 0 8px 0; color: #555; font-size: 14px;">6. Absolute 定位 + Constraints</h3>
  <div style="position: relative; width: 100%; height: 120px; background: linear-gradient(135deg, #e0e0e0, #f0f0f0); border: 1px solid #ccc; border-radius: 8px; margin-bottom: 20px;">
    <div style="position: absolute; top: 8px; left: 8px; padding: 4px 8px; background: #4CAF50; color: white; border-radius: 4px; font-size: 12px;">top-left</div>
    <div style="position: absolute; top: 8px; right: 8px; padding: 4px 8px; background: #2196F3; color: white; border-radius: 4px; font-size: 12px;">top-right</div>
    <div style="position: absolute; bottom: 8px; left: 8px; padding: 4px 8px; background: #FF9800; color: white; border-radius: 4px; font-size: 12px;">bottom-left</div>
    <div style="position: absolute; bottom: 8px; right: 8px; padding: 4px 8px; background: #9C27B0; color: white; border-radius: 4px; font-size: 12px;">bottom-right</div>
    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 4px 12px; background: #795548; color: white; border-radius: 4px; font-size: 12px;">center</div>
    <div style="position: absolute; top: 8px; left: 80px; right: 80px; padding: 4px 8px; background: #F44336; color: white; border-radius: 4px; font-size: 12px; text-align: center;">stretch-h</div>
  </div>
  <p style="margin: 0 0 20px 0; color: #999; font-size: 12px;">✅ 预期：6 个元素分别锚定到对应位置，resize 时保持锚定</p>

  <!-- 7. Fieldset/Legend -->
  <h3 style="margin: 0 0 8px 0; color: #555; font-size: 14px;">7. Fieldset / Legend</h3>
  <fieldset style="border: 2px solid #4a90d9; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
    <legend style="color: #4a90d9; font-weight: bold; padding: 0 8px;">Personal Info</legend>
    <div style="margin-bottom: 8px;">
      <label style="display: block; font-size: 13px; color: #555; margin-bottom: 4px;">Name</label>
      <input type="text" value="John Doe" style="width: 200px; padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
    </div>
    <div>
      <label style="display: block; font-size: 13px; color: #555; margin-bottom: 4px;">Email</label>
      <input type="email" value="john@example.com" style="width: 200px; padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
    </div>
  </fieldset>
  <p style="margin: 0 0 0 0; color: #999; font-size: 12px;">✅ 预期：legend 居于 fieldset 顶部边框上，白色背景遮住边框</p>
</div>`
  }
];

// Sort templates by category (basic → components → layout → advanced), then by name
const categoryOrder: Record<Template['category'], number> = {
    basic: 0,
    components: 1,
    layout: 2,
    advanced: 3,
};
templates.sort((a, b) => {
    const catDiff = categoryOrder[a.category] - categoryOrder[b.category];
    if (catDiff !== 0) return catDiff;
    return a.name.localeCompare(b.name);
});

export function getTemplatesByCategory(category: Template['category']): Template[] {
    return templates.filter(template => template.category === category);
}

export function getTemplateByName(name: string): Template | undefined {
    return templates.find(template => template.name === name);
}
