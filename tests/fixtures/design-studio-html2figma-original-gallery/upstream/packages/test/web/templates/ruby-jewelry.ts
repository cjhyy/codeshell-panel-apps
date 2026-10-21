export const rubyJewelryHTML = `
<html lang="zh" class="fusion-extension-loaded"><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no">
    <title>Ruby珠宝 - 意式奢华，法式浪漫，永恒之光</title>
    
    <!-- Design Specifications:
    - Style: Elegant luxury jewelry design with sophisticated black and white aesthetic
    - Primary Color: #e64980 (Ruby red for jewelry theme)
    - Secondary Colors: #2e2e2e (dark), #f8f9fa (light)
    - Typography: Clean, elegant fonts with proper hierarchy
    - Layout: Responsive design with hero section, product showcase, and contact information
    - Visual Elements: Minimalist design with focus on jewelry presentation
    -->
    
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://echarts.apache.org/zh/js/vendors/echarts/dist/echarts.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    
    <style>
        :root {
            --sb-track-color: transparent;
            --sb-thumb-color: rgb(180, 180, 180);
            --sb-size: 5px;
        }

        ::-webkit-scrollbar {
            width: var(--sb-size);
            height: var(--sb-size);
        }

        ::-webkit-scrollbar-track {
            background: var(--sb-track-color);
            border-radius: 5px;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--sb-thumb-color);
            border-radius: 5px;
        }

        @supports not selector(::-webkit-scrollbar) {
            body {
                scrollbar-color: var(--sb-thumb-color) var(--sb-track-color);
            }
        }

        html {
            height: 100%;
            scroll-behavior: smooth;
        }

        body {
            height: 100%;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .hero-bg {
            background: linear-gradient(135deg, rgba(46, 46, 46, 0.9) 0%, rgba(230, 73, 128, 0.1) 100%);
            backdrop-filter: blur(10px);
        }

        .jewelry-card {
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
        }

        .jewelry-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 20px 40px rgba(230, 73, 128, 0.2);
        }

        .nav-link {
            position: relative;
            transition: color 0.3s ease;
        }

        .nav-link::after {
            content: '';
            position: absolute;
            width: 0;
            height: 2px;
            bottom: -5px;
            left: 50%;
            background-color: #e64980;
            transition: all 0.3s ease;
            transform: translateX(-50%);
        }

        .nav-link:hover::after {
            width: 100%;
        }

        .section-divider {
            background: linear-gradient(90deg, transparent 0%, #e64980 50%, transparent 100%);
            height: 1px;
            width: 100px;
            margin: 0 auto;
        }

        .contact-form input,
        .contact-form textarea,
        .contact-form select {
            transition: all 0.3s ease;
        }

        .contact-form input:focus,
        .contact-form textarea:focus,
        .contact-form select:focus {
            border-color: #e64980;
            box-shadow: 0 0 0 3px rgba(230, 73, 128, 0.1);
        }
    </style>
<style>*, ::before, ::after{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness:proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgb(59 130 246 / 0.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: ;--tw-contain-size: ;--tw-contain-layout: ;--tw-contain-paint: ;--tw-contain-style: }::backdrop{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness:proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgb(59 130 246 / 0.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: ;--tw-contain-size: ;--tw-contain-layout: ;--tw-contain-paint: ;--tw-contain-style: }/* ! tailwindcss v3.4.17 | MIT License | https://tailwindcss.com */*,::after,::before{box-sizing:border-box;border-width:0;border-style:solid;border-color:#e5e7eb}::after,::before{--tw-content:''}:host,html{line-height:1.5;-webkit-text-size-adjust:100%;-moz-tab-size:4;tab-size:4;font-family:ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";font-feature-settings:normal;font-variation-settings:normal;-webkit-tap-highlight-color:transparent}body{margin:0;line-height:inherit}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,pre,samp{font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;font-feature-settings:normal;font-variation-settings:normal;font-size:1em}small{font-size:80%}sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}button,input,optgroup,select,textarea{font-family:inherit;font-feature-settings:inherit;font-variation-settings:inherit;font-size:100%;font-weight:inherit;line-height:inherit;letter-spacing:inherit;color:inherit;margin:0;padding:0}button,select{text-transform:none}button,input:where([type=button]),input:where([type=reset]),input:where([type=submit]){-webkit-appearance:button;background-color:transparent;background-image:none}:-moz-focusring{outline:auto}:-moz-ui-invalid{box-shadow:none}progress{vertical-align:baseline}::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}[type=search]{-webkit-appearance:textfield;outline-offset:-2px}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-file-upload-button{-webkit-appearance:button;font:inherit}summary{display:list-item}blockquote,dd,dl,figure,h1,h2,h3,h4,h5,h6,hr,p,pre{margin:0}fieldset{margin:0;padding:0}legend{padding:0}menu,ol,ul{list-style:none;margin:0;padding:0}dialog{padding:0}textarea{resize:vertical}input::placeholder,textarea::placeholder{opacity:1;color:#9ca3af}[role=button],button{cursor:pointer}:disabled{cursor:default}audio,canvas,embed,iframe,img,object,svg,video{display:block;vertical-align:middle}img,video{max-width:100%;height:auto}[hidden]:where(:not([hidden=until-found])){display:none}.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}.inset-0{inset:0px}.bottom-20{bottom:5rem}.left-10{left:2.5rem}.left-20{left:5rem}.right-10{right:2.5rem}.right-20{right:5rem}.top-0{top:0px}.top-1\/2{top:50%}.top-1\/3{top:33.333333%}.top-20{top:5rem}.z-10{z-index:10}.z-50{z-index:50}.mx-auto{margin-left:auto;margin-right:auto}.mb-12{margin-bottom:3rem}.mb-16{margin-bottom:4rem}.mb-2{margin-bottom:0.5rem}.mb-3{margin-bottom:0.75rem}.mb-4{margin-bottom:1rem}.mb-6{margin-bottom:1.5rem}.mb-8{margin-bottom:2rem}.ml-10{margin-left:2.5rem}.ml-4{margin-left:1rem}.mt-1{margin-top:0.25rem}.mt-8{margin-top:2rem}.block{display:block}.flex{display:flex}.grid{display:grid}.hidden{display:none}.h-12{height:3rem}.h-16{height:4rem}.h-2{height:0.5rem}.h-20{height:5rem}.h-6{height:1.5rem}.h-\[200px\]{height:200px}.h-\[256px\]{height:256px}.h-\[320px\]{height:320px}.h-full{height:100%}.min-h-screen{min-height:100vh}.w-12{width:3rem}.w-16{width:4rem}.w-2{width:0.5rem}.w-20{width:5rem}.w-6{width:1.5rem}.w-\[384px\]{width:384px}.w-\[480px\]{width:480px}.w-full{width:100%}.max-w-3xl{max-width:48rem}.max-w-4xl{max-width:56rem}.max-w-7xl{max-width:80rem}.flex-shrink-0{flex-shrink:0}.transform{transform:translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}@keyframes ping{75%, 100%{transform:scale(2);opacity:0}}.animate-ping{animation:ping 1s cubic-bezier(0, 0, 0.2, 1) infinite}@keyframes pulse{50%{opacity:.5}}.animate-pulse{animation:pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite}.flex-col{flex-direction:column}.items-start{align-items:flex-start}.items-center{align-items:center}.items-baseline{align-items:baseline}.justify-center{justify-content:center}.justify-between{justify-content:space-between}.gap-12{gap:3rem}.gap-4{gap:1rem}.gap-8{gap:2rem}.space-x-3 > :not([hidden]) ~ :not([hidden]){--tw-space-x-reverse:0;margin-right:calc(0.75rem * var(--tw-space-x-reverse));margin-left:calc(0.75rem * calc(1 - var(--tw-space-x-reverse)))}.space-x-4 > :not([hidden]) ~ :not([hidden]){--tw-space-x-reverse:0;margin-right:calc(1rem * var(--tw-space-x-reverse));margin-left:calc(1rem * calc(1 - var(--tw-space-x-reverse)))}.space-x-8 > :not([hidden]) ~ :not([hidden]){--tw-space-x-reverse:0;margin-right:calc(2rem * var(--tw-space-x-reverse));margin-left:calc(2rem * calc(1 - var(--tw-space-x-reverse)))}.space-y-1 > :not([hidden]) ~ :not([hidden]){--tw-space-y-reverse:0;margin-top:calc(0.25rem * calc(1 - var(--tw-space-y-reverse)));margin-bottom:calc(0.25rem * var(--tw-space-y-reverse))}.space-y-2 > :not([hidden]) ~ :not([hidden]){--tw-space-y-reverse:0;margin-top:calc(0.5rem * calc(1 - var(--tw-space-y-reverse)));margin-bottom:calc(0.5rem * var(--tw-space-y-reverse))}.space-y-3 > :not([hidden]) ~ :not([hidden]){--tw-space-y-reverse:0;margin-top:calc(0.75rem * calc(1 - var(--tw-space-y-reverse)));margin-bottom:calc(0.75rem * var(--tw-space-y-reverse))}.space-y-4 > :not([hidden]) ~ :not([hidden]){--tw-space-y-reverse:0;margin-top:calc(1rem * calc(1 - var(--tw-space-y-reverse)));margin-bottom:calc(1rem * var(--tw-space-y-reverse))}.space-y-6 > :not([hidden]) ~ :not([hidden]){--tw-space-y-reverse:0;margin-top:calc(1.5rem * calc(1 - var(--tw-space-y-reverse)));margin-bottom:calc(1.5rem * var(--tw-space-y-reverse))}.space-y-8 > :not([hidden]) ~ :not([hidden]){--tw-space-y-reverse:0;margin-top:calc(2rem * calc(1 - var(--tw-space-y-reverse)));margin-bottom:calc(2rem * var(--tw-space-y-reverse))}.overflow-hidden{overflow:hidden}.rounded-2xl{border-radius:1rem}.rounded-full{border-radius:9999px}.rounded-lg{border-radius:0.5rem}.rounded-xl{border-radius:0.75rem}.border{border-width:1px}.border-2{border-width:2px}.border-b{border-bottom-width:1px}.border-t{border-top-width:1px}.border-gray-100{--tw-border-opacity:1;border-color:rgb(243 244 246 / var(--tw-border-opacity, 1))}.border-gray-300{--tw-border-opacity:1;border-color:rgb(209 213 219 / var(--tw-border-opacity, 1))}.border-gray-800{--tw-border-opacity:1;border-color:rgb(31 41 55 / var(--tw-border-opacity, 1))}.border-pink-400\/30{border-color:rgb(244 114 182 / 0.3)}.border-white{--tw-border-opacity:1;border-color:rgb(255 255 255 / var(--tw-border-opacity, 1))}.bg-black\/20{background-color:rgb(0 0 0 / 0.2)}.bg-gray-50{--tw-bg-opacity:1;background-color:rgb(249 250 251 / var(--tw-bg-opacity, 1))}.bg-gray-900{--tw-bg-opacity:1;background-color:rgb(17 24 39 / var(--tw-bg-opacity, 1))}.bg-pink-100{--tw-bg-opacity:1;background-color:rgb(252 231 243 / var(--tw-bg-opacity, 1))}.bg-pink-400{--tw-bg-opacity:1;background-color:rgb(244 114 182 / var(--tw-bg-opacity, 1))}.bg-pink-600{--tw-bg-opacity:1;background-color:rgb(219 39 119 / var(--tw-bg-opacity, 1))}.bg-white{--tw-bg-opacity:1;background-color:rgb(255 255 255 / var(--tw-bg-opacity, 1))}.bg-white\/95{background-color:rgb(255 255 255 / 0.95)}.bg-gradient-to-br{background-image:linear-gradient(to bottom right, var(--tw-gradient-stops))}.bg-gradient-to-r{background-image:linear-gradient(to right, var(--tw-gradient-stops))}.from-gray-900{--tw-gradient-from:#111827 var(--tw-gradient-from-position);--tw-gradient-to:rgb(17 24 39 / 0) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from), var(--tw-gradient-to)}.from-pink-50{--tw-gradient-from:#fdf2f8 var(--tw-gradient-from-position);--tw-gradient-to:rgb(253 242 248 / 0) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from), var(--tw-gradient-to)}.via-gray-800{--tw-gradient-to:rgb(31 41 55 / 0)  var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from), #1f2937 var(--tw-gradient-via-position), var(--tw-gradient-to)}.to-gray-50{--tw-gradient-to:#f9fafb var(--tw-gradient-to-position)}.to-pink-900{--tw-gradient-to:#831843 var(--tw-gradient-to-position)}.object-cover{object-fit:cover}.p-6{padding:1.5rem}.p-8{padding:2rem}.px-2{padding-left:0.5rem;padding-right:0.5rem}.px-3{padding-left:0.75rem;padding-right:0.75rem}.px-4{padding-left:1rem;padding-right:1rem}.px-6{padding-left:1.5rem;padding-right:1.5rem}.px-8{padding-left:2rem;padding-right:2rem}.py-12{padding-top:3rem;padding-bottom:3rem}.py-2{padding-top:0.5rem;padding-bottom:0.5rem}.py-20{padding-top:5rem;padding-bottom:5rem}.py-3{padding-top:0.75rem;padding-bottom:0.75rem}.pb-3{padding-bottom:0.75rem}.pt-2{padding-top:0.5rem}.pt-8{padding-top:2rem}.text-center{text-align:center}.text-2xl{font-size:1.5rem;line-height:2rem}.text-3xl{font-size:1.875rem;line-height:2.25rem}.text-4xl{font-size:2.25rem;line-height:2.5rem}.text-lg{font-size:1.125rem;line-height:1.75rem}.text-sm{font-size:0.875rem;line-height:1.25rem}.text-xl{font-size:1.25rem;line-height:1.75rem}.text-xs{font-size:0.75rem;line-height:1rem}.font-bold{font-weight:700}.font-medium{font-weight:500}.font-semibold{font-weight:600}.leading-relaxed{line-height:1.625}.leading-tight{line-height:1.25}.text-gray-200{--tw-text-opacity:1;color:rgb(229 231 235 / var(--tw-text-opacity, 1))}.text-gray-400{--tw-text-opacity:1;color:rgb(156 163 175 / var(--tw-text-opacity, 1))}.text-gray-600{--tw-text-opacity:1;color:rgb(75 85 99 / var(--tw-text-opacity, 1))}.text-gray-700{--tw-text-opacity:1;color:rgb(55 65 81 / var(--tw-text-opacity, 1))}.text-gray-900{--tw-text-opacity:1;color:rgb(17 24 39 / var(--tw-text-opacity, 1))}.text-pink-400{--tw-text-opacity:1;color:rgb(244 114 182 / var(--tw-text-opacity, 1))}.text-pink-600{--tw-text-opacity:1;color:rgb(219 39 119 / var(--tw-text-opacity, 1))}.text-white{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity, 1))}.shadow-lg{--tw-shadow:0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);--tw-shadow-colored:0 10px 15px -3px var(--tw-shadow-color), 0 4px 6px -4px var(--tw-shadow-color);box-shadow:var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow)}.backdrop-blur-md{--tw-backdrop-blur:blur(12px);-webkit-backdrop-filter:var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia);backdrop-filter:var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia)}.transition-all{transition-property:all;transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1);transition-duration:150ms}.transition-colors{transition-property:color, background-color, border-color, fill, stroke, -webkit-text-decoration-color;transition-property:color, background-color, border-color, text-decoration-color, fill, stroke;transition-property:color, background-color, border-color, text-decoration-color, fill, stroke, -webkit-text-decoration-color;transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1);transition-duration:150ms}.delay-1000{transition-delay:1000ms}.delay-500{transition-delay:500ms}.duration-300{transition-duration:300ms}.hover\:scale-105:hover{--tw-scale-x:1.05;--tw-scale-y:1.05;transform:translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}.hover\:bg-pink-200:hover{--tw-bg-opacity:1;background-color:rgb(251 207 232 / var(--tw-bg-opacity, 1))}.hover\:bg-pink-700:hover{--tw-bg-opacity:1;background-color:rgb(190 24 93 / var(--tw-bg-opacity, 1))}.hover\:bg-white:hover{--tw-bg-opacity:1;background-color:rgb(255 255 255 / var(--tw-bg-opacity, 1))}.hover\:text-gray-900:hover{--tw-text-opacity:1;color:rgb(17 24 39 / var(--tw-text-opacity, 1))}.hover\:text-pink-400:hover{--tw-text-opacity:1;color:rgb(244 114 182 / var(--tw-text-opacity, 1))}.hover\:text-pink-600:hover{--tw-text-opacity:1;color:rgb(219 39 119 / var(--tw-text-opacity, 1))}.focus\:border-transparent:focus{border-color:transparent}.focus\:outline-none:focus{outline:2px solid transparent;outline-offset:2px}.focus\:ring-2:focus{--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000)}.focus\:ring-pink-500:focus{--tw-ring-opacity:1;--tw-ring-color:rgb(236 72 153 / var(--tw-ring-opacity, 1))}@media (min-width: 640px){.sm\:flex-row{flex-direction:row}.sm\:px-6{padding-left:1.5rem;padding-right:1.5rem}}@media (min-width: 768px){.md\:block{display:block}.md\:hidden{display:none}.md\:grid-cols-2{grid-template-columns:repeat(2, minmax(0, 1fr))}.md\:grid-cols-3{grid-template-columns:repeat(3, minmax(0, 1fr))}.md\:grid-cols-4{grid-template-columns:repeat(4, minmax(0, 1fr))}.md\:p-12{padding:3rem}.md\:text-2xl{font-size:1.5rem;line-height:2rem}.md\:text-4xl{font-size:2.25rem;line-height:2.5rem}.md\:text-6xl{font-size:3.75rem;line-height:1}}@media (min-width: 1024px){.lg\:grid-cols-2{grid-template-columns:repeat(2, minmax(0, 1fr))}.lg\:grid-cols-3{grid-template-columns:repeat(3, minmax(0, 1fr))}.lg\:px-8{padding-left:2rem;padding-right:2rem}.lg\:text-7xl{font-size:4.5rem;line-height:1}}</style><style id="fusion-selection-styles">
  .fusion-element-highlight {
    outline: 2px solid #6366f1 !important;
    outline-style: solid !important;
  }
  
  .fusion-element-selected {
    outline: 5px solid #10b981 !important;
    outline-style: solid !important;
    outline-offset: 3px !important;
    animation: fusion-selected-pulse 2s ease-in-out infinite !important;
  }
  
  @keyframes fusion-selected-pulse {
    0% { 
      outline-color: #10b981 !important;
      outline-width: 5px !important;
      outline-offset: 3px !important;
    }
    50% { 
      outline-color: #059669 !important;
      outline-width: 6px !important;
      outline-offset: 4px !important;
    }
    100% { 
      outline-color: #10b981 !important;
      outline-width: 5px !important;
      outline-offset: 3px !important;
    }
  }
  
  .fusion-selection-overlay {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    background: rgba(0, 0, 0, 0.05) !important;
    z-index: 2147483647 !important;
    cursor: crosshair !important;
    pointer-events: none !important;
  }
  
  .fusion-selection-tooltip {
    position: fixed !important;
    background: #1f2937 !important;
    color: white !important;
    padding: 8px 12px !important;
    border-radius: 6px !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    z-index: 2147483648 !important;
    pointer-events: none !important;
    transform: translate(-50%, -100%) translateY(-10px) !important;
    white-space: nowrap !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
  }
  
  .fusion-selection-tooltip::after {
    content: '' !important;
    position: absolute !important;
    top: 100% !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    border: 5px solid transparent !important;
    border-top-color: #1f2937 !important;
  }
  
  
  @keyframes fusion-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  @keyframes fusion-label-bounce {
    0% { 
      opacity: 0;
      transform: translateY(-10px) scale(0.9);
    }
    50% {
      opacity: 1;
      transform: translateY(0) scale(1.05);
    }
    100% { 
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style><style data-id="immersive-translate-input-injected-css">.immersive-translate-input {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  bottom: 0;
  z-index: 2147483647;
  display: flex;
  justify-content: center;
  align-items: center;
}
.immersive-translate-attach-loading::after {
  content: " ";

  --loading-color: #f78fb6;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: block;
  margin: 12px auto;
  position: relative;
  color: white;
  left: -100px;
  box-sizing: border-box;
  animation: immersiveTranslateShadowRolling 1.5s linear infinite;

  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-2000%, -50%);
  z-index: 100;
}

.immersive-translate-loading-spinner {
  vertical-align: middle !important;
  width: 10px !important;
  height: 10px !important;
  display: inline-block !important;
  margin: 0 4px !important;
  border: 2px rgba(221, 244, 255, 0.6) solid !important;
  border-top: 2px rgba(0, 0, 0, 0.375) solid !important;
  border-left: 2px rgba(0, 0, 0, 0.375) solid !important;
  border-radius: 50% !important;
  padding: 0 !important;
  -webkit-animation: immersive-translate-loading-animation 0.6s infinite linear !important;
  animation: immersive-translate-loading-animation 0.6s infinite linear !important;
}

@-webkit-keyframes immersive-translate-loading-animation {
  from {
    -webkit-transform: rotate(0deg);
  }

  to {
    -webkit-transform: rotate(359deg);
  }
}

@keyframes immersive-translate-loading-animation {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(359deg);
  }
}

.immersive-translate-input-loading {
  --loading-color: #f78fb6;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: block;
  margin: 12px auto;
  position: relative;
  color: white;
  left: -100px;
  box-sizing: border-box;
  animation: immersiveTranslateShadowRolling 1.5s linear infinite;
}

@keyframes immersiveTranslateShadowRolling {
  0% {
    box-shadow: 0px 0 rgba(255, 255, 255, 0), 0px 0 rgba(255, 255, 255, 0),
      0px 0 rgba(255, 255, 255, 0), 0px 0 rgba(255, 255, 255, 0);
  }

  12% {
    box-shadow: 100px 0 var(--loading-color), 0px 0 rgba(255, 255, 255, 0),
      0px 0 rgba(255, 255, 255, 0), 0px 0 rgba(255, 255, 255, 0);
  }

  25% {
    box-shadow: 110px 0 var(--loading-color), 100px 0 var(--loading-color),
      0px 0 rgba(255, 255, 255, 0), 0px 0 rgba(255, 255, 255, 0);
  }

  36% {
    box-shadow: 120px 0 var(--loading-color), 110px 0 var(--loading-color),
      100px 0 var(--loading-color), 0px 0 rgba(255, 255, 255, 0);
  }

  50% {
    box-shadow: 130px 0 var(--loading-color), 120px 0 var(--loading-color),
      110px 0 var(--loading-color), 100px 0 var(--loading-color);
  }

  62% {
    box-shadow: 200px 0 rgba(255, 255, 255, 0), 130px 0 var(--loading-color),
      120px 0 var(--loading-color), 110px 0 var(--loading-color);
  }

  75% {
    box-shadow: 200px 0 rgba(255, 255, 255, 0), 200px 0 rgba(255, 255, 255, 0),
      130px 0 var(--loading-color), 120px 0 var(--loading-color);
  }

  87% {
    box-shadow: 200px 0 rgba(255, 255, 255, 0), 200px 0 rgba(255, 255, 255, 0),
      200px 0 rgba(255, 255, 255, 0), 130px 0 var(--loading-color);
  }

  100% {
    box-shadow: 200px 0 rgba(255, 255, 255, 0), 200px 0 rgba(255, 255, 255, 0),
      200px 0 rgba(255, 255, 255, 0), 200px 0 rgba(255, 255, 255, 0);
  }
}

.immersive-translate-toast {
  display: flex;
  position: fixed;
  z-index: 2147483647;
  left: 0;
  right: 0;
  top: 1%;
  width: fit-content;
  padding: 12px 20px;
  margin: auto;
  overflow: auto;
  background: #fef6f9;
  box-shadow: 0px 4px 10px 0px rgba(0, 10, 30, 0.06);
  font-size: 15px;
  border-radius: 8px;
  color: #333;
}

.immersive-translate-toast-content {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.immersive-translate-toast-hidden {
  margin: 0 20px 0 72px;
  text-decoration: underline;
  cursor: pointer;
}

.immersive-translate-toast-close {
  color: #666666;
  font-size: 20px;
  font-weight: bold;
  padding: 0 10px;
  cursor: pointer;
}

@media screen and (max-width: 768px) {
  .immersive-translate-toast {
    top: 0;
    padding: 12px 0px 0 10px;
  }
  .immersive-translate-toast-content {
    flex-direction: column;
    text-align: center;
  }
  .immersive-translate-toast-hidden {
    margin: 10px auto;
  }
}

.immersive-translate-dialog {
  position: fixed;
  z-index: 2147483647;
  left: 0;
  top: 0;
  display: flex;
  width: 300px;
  flex-direction: column;
  align-items: center;
  font-size: 15px;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  margin: auto;
  height: fit-content;
  border-radius: 20px;
  background-color: #fff;
}

.immersive-translate-modal {
  display: none;
  position: fixed;
  z-index: 2147483647;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  background-color: rgb(0, 0, 0);
  background-color: rgba(0, 0, 0, 0.4);
  font-size: 15px;
}

.immersive-translate-modal-content {
  background-color: #fefefe;
  margin: 10% auto;
  padding: 40px 24px 24px;
  border-radius: 12px;
  width: 350px;
  font-family: system-ui, -apple-system, "Segoe UI", "Roboto", "Ubuntu",
    "Cantarell", "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji",
    "Segoe UI Symbol", "Noto Color Emoji";
  position: relative;
}

@media screen and (max-width: 768px) {
  .immersive-translate-modal-content {
    margin: 25% auto !important;
  }
}

@media screen and (max-width: 480px) {
  .immersive-translate-modal-content {
    width: 80vw !important;
    margin: 20vh auto !important;
    padding: 20px 12px 12px !important;
  }

  .immersive-translate-modal-title {
    font-size: 14px !important;
  }

  .immersive-translate-modal-body {
    font-size: 13px !important;
    max-height: 60vh !important;
  }

  .immersive-translate-btn {
    font-size: 13px !important;
    padding: 8px 16px !important;
    margin: 0 4px !important;
  }

  .immersive-translate-modal-footer {
    gap: 6px !important;
    margin-top: 16px !important;
  }
}

.immersive-translate-modal .immersive-translate-modal-content-in-input {
  max-width: 500px;
}
.immersive-translate-modal-content-in-input .immersive-translate-modal-body {
  text-align: left;
  max-height: unset;
}

.immersive-translate-modal-title {
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  color: #333333;
}

.immersive-translate-modal-body {
  text-align: center;
  font-size: 14px;
  font-weight: 400;
  color: #333333;
  margin-top: 24px;
  word-break: break-all;
}

@media screen and (max-width: 768px) {
  .immersive-translate-modal-body {
    max-height: 250px;
    overflow-y: auto;
  }
}

.immersive-translate-close {
  color: #666666;
  position: absolute;
  right: 16px;
  top: 16px;
  font-size: 20px;
  font-weight: bold;
}

.immersive-translate-close:hover,
.immersive-translate-close:focus {
  text-decoration: none;
  cursor: pointer;
}

.immersive-translate-modal-footer {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 24px;
}

.immersive-translate-btn {
  width: fit-content;
  color: #fff;
  background-color: #ea4c89;
  border: none;
  font-size: 14px;
  margin: 0 8px;
  padding: 9px 30px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.3s ease;
}

.immersive-translate-btn-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.immersive-translate-btn:hover {
  background-color: #f082ac;
}
.immersive-translate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.immersive-translate-btn:disabled:hover {
  background-color: #ea4c89;
}

.immersive-translate-link-btn {
  background-color: transparent;
  color: #ea4c89;
  border: none;
  cursor: pointer;
  height: 30px;
  line-height: 30px;
}

.immersive-translate-cancel-btn {
  /* gray color */
  background-color: rgb(89, 107, 120);
}

.immersive-translate-cancel-btn:hover {
  background-color: hsl(205, 20%, 32%);
}

.immersive-translate-action-btn {
  background-color: transparent;
  color: #ea4c89;
  border: 1px solid #ea4c89;
}

.immersive-translate-btn svg {
  margin-right: 5px;
}

.immersive-translate-link {
  cursor: pointer;
  user-select: none;
  -webkit-user-drag: none;
  text-decoration: none;
  color: #ea4c89;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0.1);
}

.immersive-translate-primary-link {
  cursor: pointer;
  user-select: none;
  -webkit-user-drag: none;
  text-decoration: none;
  color: #ea4c89;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0.1);
}

.immersive-translate-modal input[type="radio"] {
  margin: 0 6px;
  cursor: pointer;
}

.immersive-translate-modal label {
  cursor: pointer;
}

.immersive-translate-close-action {
  position: absolute;
  top: 2px;
  right: 0px;
  cursor: pointer;
}

.imt-image-status {
  background-color: rgba(0, 0, 0, 0.5) !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 16px !important;
}
.imt-image-status img,
.imt-image-status svg,
.imt-img-loading {
  width: 28px !important;
  height: 28px !important;
  margin: 0 0 8px 0 !important;
  min-height: 28px !important;
  min-width: 28px !important;
  position: relative !important;
}
.imt-img-loading {
  background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4CAMAAACfWMssAAAAtFBMVEUAAAD////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////oK74hAAAAPHRSTlMABBMIDyQXHwyBfFdDMSw+OjXCb+5RG51IvV/k0rOqlGRM6KKMhdvNyZBz9MaupmxpWyj437iYd/yJVNZeuUC7AAACt0lEQVRIx53T2XKiUBCA4QYOiyCbiAsuuGBcYtxiYtT3f6/pbqoYHVFO5r+iivpo6DpAWYpqeoFfr9f90DsYAuRSWkFnPO50OgR9PwiCUFcl2GEcx+N/YBh6pvKaefHlUgZd1zVe0NbYcQjGBfzrPE8Xz8aF+71D8gG6DHFPpc4a7xFiCDuhaWgKgGIJQ3d5IMGDrpS4S5KgpIm+en9f6PlAhKby4JwEIxlYJV9h5k5nee9GoxHJ2IDSNB0dwdad1NAxDJ/uXDHYmebdk4PdbkS58CIVHdYSUHTYYRWOJblWSyu2lmy3KNFVJNBhxcuGW4YBVCbYGRZwIooipHsNqjM4FbgOQqQqSKQQU9V8xmi1QlgHqQQ6DDBvRUVCDirs+EzGDGOQTCATgtYTnbCVLgsVgRE0T1QE0qHCFAht2z6dLvJQs3Lo2FQoDxWNUiBhaP4eRgwNkI+dAjVOA/kUrIDwf3CG8NfNOE0eiFotSuo+rBiq8tD9oY4Qzc6YJw99hl1wzpQvD7ef2M8QgnOGJfJw+EltQc+oX2yn907QB22WZcvlUpd143dqQu+8pCJZuGE4xCuPXJqqcs5sNpsI93Rmzym1k4Npk+oD1SH3/a3LOK/JpUBpWfqNySxWzCfNCUITuDG5dtuphrUJ1myeIE9bIsPiKrfqTai5WZxbhtNphYx6GEIHihyGFTI69lje/rxajdh0s0msZ0zYxyPLhYCb1CyHm9Qsd2H37Y3lugVwL9kNh8Ot8cha6fUNQ8nuXi5z9/ExsAO4zQrb/ev1yrCB7lGyQzgYDGuxq1toDN/JGvN+HyWNHKB7zEoK+PX11e12G431erGYzwmytAWU56fkMHY5JJnDRR2eZji3AwtIcrEV8Cojat/BdQ7XOwGV1e1hDjGGjXbdArm8uJZtCH5MbcctVX8A1WpqumJHwckAAAAASUVORK5CYII=");
  background-size: 28px 28px;
  animation: image-loading-rotate 1s linear infinite !important;
}

.imt-image-status span {
  color: var(--bg-2, #fff) !important;
  font-size: 14px !important;
  line-height: 14px !important;
  font-weight: 500 !important;
  font-family: "PingFang SC", Arial, sans-serif !important;
}

.imt-primary-button {
  display: flex;
  padding: 12px 80px;
  justify-content: center;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  background: #ea4c89;
  color: #fff;
  font-size: 16px;
  font-style: normal;
  font-weight: 700;
  line-height: 24px;
  border: none;
  cursor: pointer;
}

.imt-retry-text {
  color: #999;
  text-align: center;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 21px;
  cursor: pointer;
}

.imt-action-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.imt-modal-content-text {
  text-align: left;
  color: #333;
  font-size: 16px;
  font-weight: 400;
  line-height: 24px;
}

@keyframes image-loading-rotate {
  from {
    transform: rotate(360deg);
  }
  to {
    transform: rotate(0deg);
  }
}

.imt-linear-gradient-text {
  background: linear-gradient(90deg, #00a6ff 0%, #c369ff 52.4%, #ff4590 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.imt-flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

.imt-linear-black-btn {
  border-radius: 50px;
  background: linear-gradient(66deg, #222 19%, #696969 94.25%);
  height: 48px;
  width: 100%;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  cursor: pointer;
  justify-content: center;
}
</style></head>
<body class="bg-white">
    <!-- Navigation -->


    <!-- Hero Section -->
    <section id="home" class="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div class="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-pink-900"></div>
        <div class="absolute inset-0 bg-black/20"></div>
        
        <div class="relative z-10 text-center text-white px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
            <h1 class="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
                <span data-editable="true" data-source-id="1,2">Ruby：意式奢华，法式浪漫，永恒之光</span>
            </h1>
            <p class="text-xl md:text-2xl mb-8 text-gray-200 leading-relaxed">
                <span data-editable="true" data-source-id="1,2">探索Ruby珠宝，感受匠心独运的意式精髓与法式情怀，点亮您的每一个珍贵时刻</span>
            </p>
            <div class="section-divider mb-8"></div>
            <div class="flex flex-col sm:flex-row gap-4 justify-center">
                <button class="bg-pink-600 hover:bg-pink-700 text-white px-8 py-3 rounded-full font-medium transition-all duration-300 transform hover:scale-105">
                    <span data-editable="true">探索系列</span>
                </button>
                <button class="border-2 border-white text-white hover:bg-white hover:text-gray-900 px-8 py-3 rounded-full font-medium transition-all duration-300">
                    <span data-editable="true">预约咨询</span>
                </button>
            </div>
        </div>
        
        <!-- Decorative elements -->
        <div class="absolute top-20 left-10 w-20 h-20 border border-pink-400/30 rounded-full animate-pulse"></div>
        <div class="absolute bottom-20 right-10 w-16 h-16 border border-pink-400/30 rounded-full animate-pulse delay-1000"></div>
        <div class="absolute top-1/2 left-20 w-2 h-2 bg-pink-400 rounded-full animate-ping"></div>
        <div class="absolute top-1/3 right-20 w-2 h-2 bg-pink-400 rounded-full animate-ping delay-500"></div>
    </section>

  

</body><div id="immersive-translate-browser-popup" style="all: initial"></div></html>`;

        const defaultHTML = `<html lang="zh" class="fusion-extension-loaded"><head class="">
    <title class="">人工智能 - 掘金</title><meta data-n-head="ssr" charset="utf-8" class=""><meta data-n-head="ssr" name="viewport" content="width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover" class=""><meta data-n-head="ssr" name="apple-itunes-app" content="app-id=987739104" class=""><meta data-n-head="ssr" name="theme-color" content="#ffffff" class=""><meta data-n-head="ssr" name="msapplication-TileColor" content="#da532c" class=""><meta data-n-head="ssr" name="msvalidate.01" content="BADCF2429624CB0432BE8924E5343343" class=""><meta data-n-head="ssr" name="google-site-verification" content="m8eimwHTlWoObBcEuX3ot93QtMJFS_zHdMZROWrX7-o" class=""><meta data-n-head="ssr" vmid="description" name="description" content="掘金是面向全球中文开发者的技术内容分享与交流平台。我们通过技术文章、沸点、课程、直播等产品和服务，打造一个激发开发者创作灵感，激励开发者沉淀分享，陪伴开发者成长的综合类技术社区。" class=""><meta data-n-head="ssr" vmid="keywords" name="keywords" content="掘金,稀土,Vue.js,前端面试题,Kotlin,ReactNative,Python, 掘金,掘金网,掘金社区,掘金开发者社区,掘金沸点,中文技术社区,前端开发社区,前端技术交流,前端框架教程,JavaScript 学习资源,CSS 技巧与最佳实践,HTML5 最新动态,前端工程师职业发展,开源前端项目,前端技术趋势" class=""><link data-n-head="ssr" rel="preconnect" href="//unpkg.byted-static.com/" crossorigin="anonymous" class=""><link data-n-head="ssr" rel="preconnect" href="//lf3-cdn-tos.bytescm.com" crossorigin="anonymous" class=""><link data-n-head="ssr" rel="preconnect" href="//mcs.snssdk.com" crossorigin="anonymous" class=""><link data-n-head="ssr" rel="preconnect" href="//i.snssdk.com" crossorigin="anonymous" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//lf3-short.ibytedapm.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//lf3-cdn-tos.bytescm.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//api.juejin.cn" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//lf-cdn-tos.bytescm.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//unpkg.byted-static.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//p1-juejin.byteimg.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//p3-juejin.byteimg.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//p6-juejin.byteimg.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//p9-juejin.byteimg.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//p1-jj.byteimg.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//p2-jj.byteimg.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//p6-jj.byteimg.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//p9-jj.byteimg.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//mcs.snssdk.com" class=""><link data-n-head="ssr" rel="dns-prefetch" href="//i.snssdk.com" class=""><link data-n-head="ssr" rel="apple-touch-icon" sizes="180x180" href="https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/apple-touch-icon.png" class=""><link data-n-head="ssr" rel="icon" type="image/png" sizes="32x32" href="https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png" class=""><link data-n-head="ssr" rel="icon" type="image/png" sizes="16x16" href="https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-16x16.png" class=""><link data-n-head="ssr" rel="mask-icon" href="https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/safari-pinned-tab.svg" color="#1E80FF" class=""><link data-n-head="ssr" rel="manifest" href="https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/site.webmanifest" class=""><link data-n-head="ssr" rel="search" title="掘金" href="https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/search.xml" type="application/opensearchdescription+xml" class=""><link data-n-head="ssr" rel="stylesheet" href="https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/bytedesign.min.css" class=""><link data-n-head="ssr" rel="canonical" href="https://juejin.cn/ai" class=""><script data-n-head="ssr" type="text/javascript" data-sdk-glue-default="load" src="https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/rc-client-security-web-glue/1.0.0.19/sdk-glue.js" class=""></script><script data-n-head="ssr" type="text/javascript" data-sdk-glue-default="init" class="">
        (function (){
          var options = {
            bdms: {
              aid: 2608,
              paths: [
                '/growth_api/v1/publish_benefit_history',
                '/growth_api/v1/check_in',
                '/growth_api/v1/lottery/draw',
                '/growth_api/v1/lottery/ten_draw',
                '/web_shorten',
                '/user_api/v1/user/get',
                '/interact_api/v1/digg/save',
                '/interact_api/v1/digg/query_page',
                '/interact_api/v1/comment/list',
                '/interact_api/v1/comment/hots',
                '/content_api/v1/article/detail',
                '/user_api/v1/follow/followees',
                '/user_api/v1/follow/followers',
                '/interact_api/v1/follow/tag_list',
                '/recommend_api/v1/article/recommend_cate_feed',
                '/interact_api/v1/comment/publish',
                '/interact_api/v1/reply/publish',
                '/growth_api/v1/get_benefit_page',
                '/growth_api/v1/get_cur_point',
                '/growth_api/v1/ten_draw', 
                '/growth_api/v1/draw',
                '/growth_api/v1/lottery_config/get',
                '/user_api/v1/user_referral/bind',
              ]
            },
            verifyCenter: {
              interceptPathList: [
                '/user_api/v1/user/get',
                '/interact_api/v1/digg/save',
                '/interact_api/v1/digg/query_page',
                '/interact_api/v1/comment/list',
                '/interact_api/v1/comment/hots',
                '/content_api/v1/article/detail',
                '/user_api/v1/follow/followees',
                '/user_api/v1/follow/followers',
                '/interact_api/v1/follow/tag_list',
                '/recommend_api/v1/article/recommend_cate_feed',
              ],
              commonOptions: {
                aid: 2608,
                repoId: 56081
              },
              captchaOptions: {
                showMode: 'mask',
              },
            }
          }
        var sdkInfo = {
          bdms: {
            init: function (options) {
              window.bdms.init(options)
            },
            isLoaded: function () {
              return !!window.bdms
            },
            srcList: [
              'https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.33/bdms.js',
              'https://lf-c-flwb.bytetos.com/obj/rc-client-security/web/stable/1.0.0.33/bdms.js',
            ],
          },
          verifyCenter: {
            init: function (options) {
              window.TTGCaptcha.init(options);
            },
            isLoaded: function () {
              return !!window.TTGCaptcha;
            },
            srcList: [
              'https://lf-cdn-tos.bytescm.com/obj/rc-verifycenter/sec_sdk_build/4.0.10/captcha/index.js',
              'https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/sec_sdk_build/4.0.10/captcha/index.js',
            ],
          }
        }
        window._SdkGlueInit(options, sdkInfo)
        })();
        </script><script src="https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.33/bdms.js" class=""></script><script src="https://lf-cdn-tos.bytescm.com/obj/rc-verifycenter/sec_sdk_build/4.0.10/captcha/index.js" class=""></script><script data-n-head="ssr" vmid="slardar" type="text/javascript" crossorigin="anonymous" class="">;(function (w, d, u, b, n, pc, ga, ae, po, s, p, e, t, pp) {pc = 'precollect';ga = 'getAttribute';ae = 'addEventListener';po = 'PerformanceObserver';s = function (m) {p = [].slice.call(arguments);p.push(Date.now(), location.href);(m == pc ? s.p.a : s.q).push(p)};s.q = [];s.p = { a: [] };w[n] = s;e = document.createElement('script');e.src = u + '?bid=' + b + '&globalName=' + n;e.crossOrigin = u.indexOf('sdk-web') > 0 ? 'anonymous' : 'use-credentials';d.getElementsByTagName('head')[0].appendChild(e);if (ae in w) {s.pcErr = function (e) {e = e || w.event;t = e.target || e.srcElement;if (t instanceof Element || t instanceof HTMLElement) {if (t[ga]('integrity')) {w[n](pc, 'sri', t[ga]('href') || t[ga]('src'))} else {w[n](pc, 'st', { tagName: t.tagName, url: t[ga]('href') || t[ga]('src') })}} else {w[n](pc, 'err', e.error || e.message)}};s.pcRej = function (e) {e = e || w.event;w[n](pc, 'err', e.reason || (e.detail && e.detail.reason))};w[ae]('error', s.pcErr, true);w[ae]('unhandledrejection', s.pcRej, true);};if('PerformanceLongTaskTiming' in w) {pp = s.pp = { entries: [] };pp.observer = new PerformanceObserver(function (l) {pp.entries = pp.entries.concat(l.getEntries())});pp.observer.observe({ entryTypes: ['longtask', 'largest-contentful-paint','layout-shift'] })}})(window,document,'https://lf3-short.ibytedapm.com/slardar/fe/sdk-web/browser.cn.js','2608','SlardarWeb')</script><script src="https://lf3-short.ibytedapm.com/slardar/fe/sdk-web/browser.cn.js?bid=2608&amp;globalName=SlardarWeb" crossorigin="anonymous" class=""></script><script data-n-head="ssr" type="text/javascript" src="https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/slardar-plugin/imageReport.js" class=""></script><script data-n-head="ssr" type="text/javascript" src="https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/cdn-retry/bundle-dcf007.js" id="cdn-retry" defer="" class=""></script><script data-n-head="ssr" type="application/ld+json" class="">{"@context":"https://schema.org","@type":"WebSite","url":"https://juejin.cn/","potentialAction":{"@type":"SearchAction","target":"https://juejin.cn/search?query={search_term_string}","query-input":"required name=search_term_string"}}</script><link rel="preload" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/d18f829.js" as="script" class=""><link rel="preload" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/c277702.js" as="script" class=""><link rel="preload" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/fbde3a6.js" as="script" class=""><link rel="preload" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/app.6ab0eb4.css" as="style" class=""><link rel="preload" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/9150d90.js" as="script" class=""><link rel="preload" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/layouts/default.a1d6163.css" as="style" class=""><link rel="preload" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/0f99730.js" as="script" class=""><link rel="preload" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/10.ed3cb2a.css" as="style" class=""><link rel="preload" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/5621eec.js" as="script" class=""><link rel="stylesheet" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/app.6ab0eb4.css" class=""><link rel="stylesheet" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/layouts/default.a1d6163.css" class=""><link rel="stylesheet" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/10.ed3cb2a.css" class="">
  <style data-id="immersive-translate-input-injected-css" class="">.immersive-translate-input {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  bottom: 0;
  z-index: 2147483647;
  display: flex;
  justify-content: center;
  align-items: center;
}
.immersive-translate-attach-loading::after {
  content: " ";

  --loading-color: #f78fb6;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: block;
  margin: 12px auto;
  position: relative;
  color: white;
  left: -100px;
  box-sizing: border-box;
  animation: immersiveTranslateShadowRolling 1.5s linear infinite;

  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-2000%, -50%);
  z-index: 100;
}

.immersive-translate-loading-spinner {
  vertical-align: middle !important;
  width: 10px !important;
  height: 10px !important;
  display: inline-block !important;
  margin: 0 4px !important;
  border: 2px rgba(221, 244, 255, 0.6) solid !important;
  border-top: 2px rgba(0, 0, 0, 0.375) solid !important;
  border-left: 2px rgba(0, 0, 0, 0.375) solid !important;
  border-radius: 50% !important;
  padding: 0 !important;
  -webkit-animation: immersive-translate-loading-animation 0.6s infinite linear !important;
  animation: immersive-translate-loading-animation 0.6s infinite linear !important;
}

@-webkit-keyframes immersive-translate-loading-animation {
  from {
    -webkit-transform: rotate(0deg);
  }

  to {
    -webkit-transform: rotate(359deg);
  }
}

@keyframes immersive-translate-loading-animation {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(359deg);
  }
}

.immersive-translate-input-loading {
  --loading-color: #f78fb6;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: block;
  margin: 12px auto;
  position: relative;
  color: white;
  left: -100px;
  box-sizing: border-box;
  animation: immersiveTranslateShadowRolling 1.5s linear infinite;
}

@keyframes immersiveTranslateShadowRolling {
  0% {
    box-shadow: 0px 0 rgba(255, 255, 255, 0), 0px 0 rgba(255, 255, 255, 0),
      0px 0 rgba(255, 255, 255, 0), 0px 0 rgba(255, 255, 255, 0);
  }

  12% {
    box-shadow: 100px 0 var(--loading-color), 0px 0 rgba(255, 255, 255, 0),
      0px 0 rgba(255, 255, 255, 0), 0px 0 rgba(255, 255, 255, 0);
  }

  25% {
    box-shadow: 110px 0 var(--loading-color), 100px 0 var(--loading-color),
      0px 0 rgba(255, 255, 255, 0), 0px 0 rgba(255, 255, 255, 0);
  }

  36% {
    box-shadow: 120px 0 var(--loading-color), 110px 0 var(--loading-color),
      100px 0 var(--loading-color), 0px 0 rgba(255, 255, 255, 0);
  }

  50% {
    box-shadow: 130px 0 var(--loading-color), 120px 0 var(--loading-color),
      110px 0 var(--loading-color), 100px 0 var(--loading-color);
  }

  62% {
    box-shadow: 200px 0 rgba(255, 255, 255, 0), 130px 0 var(--loading-color),
      120px 0 var(--loading-color), 110px 0 var(--loading-color);
  }

  75% {
    box-shadow: 200px 0 rgba(255, 255, 255, 0), 200px 0 rgba(255, 255, 255, 0),
      130px 0 var(--loading-color), 120px 0 var(--loading-color);
  }

  87% {
    box-shadow: 200px 0 rgba(255, 255, 255, 0), 200px 0 rgba(255, 255, 255, 0),
      200px 0 rgba(255, 255, 255, 0), 130px 0 var(--loading-color);
  }

  100% {
    box-shadow: 200px 0 rgba(255, 255, 255, 0), 200px 0 rgba(255, 255, 255, 0),
      200px 0 rgba(255, 255, 255, 0), 200px 0 rgba(255, 255, 255, 0);
  }
}

.immersive-translate-toast {
  display: flex;
  position: fixed;
  z-index: 2147483647;
  left: 0;
  right: 0;
  top: 1%;
  width: fit-content;
  padding: 12px 20px;
  margin: auto;
  overflow: auto;
  background: #fef6f9;
  box-shadow: 0px 4px 10px 0px rgba(0, 10, 30, 0.06);
  font-size: 15px;
  border-radius: 8px;
  color: #333;
}

.immersive-translate-toast-content {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.immersive-translate-toast-hidden {
  margin: 0 20px 0 72px;
  text-decoration: underline;
  cursor: pointer;
}

.immersive-translate-toast-close {
  color: #666666;
  font-size: 20px;
  font-weight: bold;
  padding: 0 10px;
  cursor: pointer;
}

@media screen and (max-width: 768px) {
  .immersive-translate-toast {
    top: 0;
    padding: 12px 0px 0 10px;
  }
  .immersive-translate-toast-content {
    flex-direction: column;
    text-align: center;
  }
  .immersive-translate-toast-hidden {
    margin: 10px auto;
  }
}

.immersive-translate-dialog {
  position: fixed;
  z-index: 2147483647;
  left: 0;
  top: 0;
  display: flex;
  width: 300px;
  flex-direction: column;
  align-items: center;
  font-size: 15px;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  margin: auto;
  height: fit-content;
  border-radius: 20px;
  background-color: #fff;
}

.immersive-translate-modal {
  display: none;
  position: fixed;
  z-index: 2147483647;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  background-color: rgb(0, 0, 0);
  background-color: rgba(0, 0, 0, 0.4);
  font-size: 15px;
}

.immersive-translate-modal-content {
  background-color: #fefefe;
  margin: 10% auto;
  padding: 40px 24px 24px;
  border-radius: 12px;
  width: 350px;
  font-family: system-ui, -apple-system, "Segoe UI", "Roboto", "Ubuntu",
    "Cantarell", "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji",
    "Segoe UI Symbol", "Noto Color Emoji";
  position: relative;
}

@media screen and (max-width: 768px) {
  .immersive-translate-modal-content {
    margin: 25% auto !important;
  }
}

@media screen and (max-width: 480px) {
  .immersive-translate-modal-content {
    width: 80vw !important;
    margin: 20vh auto !important;
    padding: 20px 12px 12px !important;
  }

  .immersive-translate-modal-title {
    font-size: 14px !important;
  }

  .immersive-translate-modal-body {
    font-size: 13px !important;
    max-height: 60vh !important;
  }

  .immersive-translate-btn {
    font-size: 13px !important;
    padding: 8px 16px !important;
    margin: 0 4px !important;
  }

  .immersive-translate-modal-footer {
    gap: 6px !important;
    margin-top: 16px !important;
  }
}

.immersive-translate-modal .immersive-translate-modal-content-in-input {
  max-width: 500px;
}
.immersive-translate-modal-content-in-input .immersive-translate-modal-body {
  text-align: left;
  max-height: unset;
}

.immersive-translate-modal-title {
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  color: #333333;
}

.immersive-translate-modal-body {
  text-align: center;
  font-size: 14px;
  font-weight: 400;
  color: #333333;
  margin-top: 24px;
  word-break: break-all;
}

@media screen and (max-width: 768px) {
  .immersive-translate-modal-body {
    max-height: 250px;
    overflow-y: auto;
  }
}

.immersive-translate-close {
  color: #666666;
  position: absolute;
  right: 16px;
  top: 16px;
  font-size: 20px;
  font-weight: bold;
}

.immersive-translate-close:hover,
.immersive-translate-close:focus {
  text-decoration: none;
  cursor: pointer;
}

.immersive-translate-modal-footer {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 24px;
}

.immersive-translate-btn {
  width: fit-content;
  color: #fff;
  background-color: #ea4c89;
  border: none;
  font-size: 14px;
  margin: 0 8px;
  padding: 9px 30px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.3s ease;
}

.immersive-translate-btn-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.immersive-translate-btn:hover {
  background-color: #f082ac;
}
.immersive-translate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.immersive-translate-btn:disabled:hover {
  background-color: #ea4c89;
}

.immersive-translate-link-btn {
  background-color: transparent;
  color: #ea4c89;
  border: none;
  cursor: pointer;
  height: 30px;
  line-height: 30px;
}

.immersive-translate-cancel-btn {
  /* gray color */
  background-color: rgb(89, 107, 120);
}

.immersive-translate-cancel-btn:hover {
  background-color: hsl(205, 20%, 32%);
}

.immersive-translate-action-btn {
  background-color: transparent;
  color: #ea4c89;
  border: 1px solid #ea4c89;
}

.immersive-translate-btn svg {
  margin-right: 5px;
}

.immersive-translate-link {
  cursor: pointer;
  user-select: none;
  -webkit-user-drag: none;
  text-decoration: none;
  color: #ea4c89;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0.1);
}

.immersive-translate-primary-link {
  cursor: pointer;
  user-select: none;
  -webkit-user-drag: none;
  text-decoration: none;
  color: #ea4c89;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0.1);
}

.immersive-translate-modal input[type="radio"] {
  margin: 0 6px;
  cursor: pointer;
}

.immersive-translate-modal label {
  cursor: pointer;
}

.immersive-translate-close-action {
  position: absolute;
  top: 2px;
  right: 0px;
  cursor: pointer;
}

.imt-image-status {
  background-color: rgba(0, 0, 0, 0.5) !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 16px !important;
}
.imt-image-status img,
.imt-image-status svg,
.imt-img-loading {
  width: 28px !important;
  height: 28px !important;
  margin: 0 0 8px 0 !important;
  min-height: 28px !important;
  min-width: 28px !important;
  position: relative !important;
}
.imt-img-loading {
  background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4CAMAAACfWMssAAAAtFBMVEUAAAD////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////oK74hAAAAPHRSTlMABBMIDyQXHwyBfFdDMSw+OjXCb+5RG51IvV/k0rOqlGRM6KKMhdvNyZBz9MaupmxpWyj437iYd/yJVNZeuUC7AAACt0lEQVRIx53T2XKiUBCA4QYOiyCbiAsuuGBcYtxiYtT3f6/pbqoYHVFO5r+iivpo6DpAWYpqeoFfr9f90DsYAuRSWkFnPO50OgR9PwiCUFcl2GEcx+N/YBh6pvKaefHlUgZd1zVe0NbYcQjGBfzrPE8Xz8aF+71D8gG6DHFPpc4a7xFiCDuhaWgKgGIJQ3d5IMGDrpS4S5KgpIm+en9f6PlAhKby4JwEIxlYJV9h5k5nee9GoxHJ2IDSNB0dwdad1NAxDJ/uXDHYmebdk4PdbkS58CIVHdYSUHTYYRWOJblWSyu2lmy3KNFVJNBhxcuGW4YBVCbYGRZwIooipHsNqjM4FbgOQqQqSKQQU9V8xmi1QlgHqQQ6DDBvRUVCDirs+EzGDGOQTCATgtYTnbCVLgsVgRE0T1QE0qHCFAht2z6dLvJQs3Lo2FQoDxWNUiBhaP4eRgwNkI+dAjVOA/kUrIDwf3CG8NfNOE0eiFotSuo+rBiq8tD9oY4Qzc6YJw99hl1wzpQvD7ef2M8QgnOGJfJw+EltQc+oX2yn907QB22WZcvlUpd143dqQu+8pCJZuGE4xCuPXJqqcs5sNpsI93Rmzym1k4Npk+oD1SH3/a3LOK/JpUBpWfqNySxWzCfNCUITuDG5dtuphrUJ1myeIE9bIsPiKrfqTai5WZxbhtNphYx6GEIHihyGFTI69lje/rxajdh0s0msZ0zYxyPLhYCb1CyHm9Qsd2H37Y3lugVwL9kNh8Ot8cha6fUNQ8nuXi5z9/ExsAO4zQrb/ev1yrCB7lGyQzgYDGuxq1toDN/JGvN+HyWNHKB7zEoK+PX11e12G431erGYzwmytAWU56fkMHY5JJnDRR2eZji3AwtIcrEV8Cojat/BdQ7XOwGV1e1hDjGGjXbdArm8uJZtCH5MbcctVX8A1WpqumJHwckAAAAASUVORK5CYII=");
  background-size: 28px 28px;
  animation: image-loading-rotate 1s linear infinite !important;
}

.imt-image-status span {
  color: var(--bg-2, #fff) !important;
  font-size: 14px !important;
  line-height: 14px !important;
  font-weight: 500 !important;
  font-family: "PingFang SC", Arial, sans-serif !important;
}

.imt-primary-button {
  display: flex;
  padding: 12px 80px;
  justify-content: center;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  background: #ea4c89;
  color: #fff;
  font-size: 16px;
  font-style: normal;
  font-weight: 700;
  line-height: 24px;
  border: none;
  cursor: pointer;
}

.imt-retry-text {
  color: #999;
  text-align: center;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 21px;
  cursor: pointer;
}

.imt-action-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.imt-modal-content-text {
  text-align: left;
  color: #333;
  font-size: 16px;
  font-weight: 400;
  line-height: 24px;
}

@keyframes image-loading-rotate {
  from {
    transform: rotate(360deg);
  }
  to {
    transform: rotate(0deg);
  }
}

.imt-linear-gradient-text {
  background: linear-gradient(90deg, #00a6ff 0%, #c369ff 52.4%, #ff4590 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.imt-flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

.imt-linear-black-btn {
  border-radius: 50px;
  background: linear-gradient(66deg, #222 19%, #696969 94.25%);
  height: 48px;
  width: 100%;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  cursor: pointer;
  justify-content: center;
}
</style><style class="">._container_1lxa9_1{display:flex;flex-direction:column;align-items:center;width:100%;transition:all .4s ease-in-out}._container_1lxa9_1 svg{display:block}._second_1lxa9_11{display:flex;align-items:center;position:absolute;height:120px;font-size:40px;transition:opacity .2s ease-in-out}._tips_1lxa9_19{margin-top:18px;transition:opacity .2s ease-in-out;text-align:center;padding:0 8px}._tips_1lxa9_19 span{color:#fd6f8e}._cancelButton_1lxa9_28{width:72px;height:32px;margin-top:24px;color:#fff;background:rgba(255,255,255,.1);border:none;border-radius:8px;cursor:pointer}._stopped_1lxa9_38,._stopped_1lxa9_38 ._tips_1lxa9_19,._stopped_1lxa9_38 ._second_1lxa9_11{opacity:0}._container_2hh0t_1{display:flex;flex-direction:column;padding:16px}._title_2hh0t_6{color:#fff;margin-bottom:12px}._message_2hh0t_10{color:#98a2b3}._buttons_2hh0t_13{display:flex;flex-grow:1;justify-content:flex-end;align-items:flex-end}._buttons_2hh0t_13 button{min-width:80px;height:28px;margin-left:8px;border:none;color:#fff;background:rgba(255,255,255,.1);border-radius:4px;cursor:pointer}._buttons_2hh0t_13 button._primary_2hh0t_29{background:linear-gradient(90deg,#fe1889 0%,#ff5f7d 100%),#f63d68}._container_15hlf_1{width:36px;height:36px;border-radius:36px;cursor:pointer;opacity:1}._container_15hlf_1:hover{opacity:1}._circle_15hlf_11{display:flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:36px;border:2px solid white}._rect_15hlf_20{width:14px;height:14px;background:#e54136;border-radius:2px}._active_15hlf_26._container_15hlf_1 ._rect_15hlf_20{animation:1.2s infinite alternate _stop-button-animation_15hlf_1}@keyframes _stop-button-animation_15hlf_1{0%{opacity:1}70%{opacity:.7}to{opacity:1}}._container_14o0x_1{display:flex;align-items:center}._stopButton_14o0x_5{transition:all .4s ease-in-out}._timeDisplay_14o0x_8{margin-left:9px;font-size:14px;transition:all .3s ease-in-out}._buttons_14o0x_13{display:flex;margin-left:4px}.mini ._container_14o0x_1{width:64px;height:32px}.mini ._container_14o0x_1._recording_14o0x_21{animation:1.2s infinite alternate _mini-recorder-controller-animation_14o0x_1}.mini ._container_14o0x_1 ._stopButton_14o0x_5{transform:scale(0);width:0;opacity:0}.mini ._container_14o0x_1 ._buttons_14o0x_13{opacity:0}._container_36akj_7{display:flex;align-items:center;justify-content:center;position:fixed;z-index:9999999;width:136px;height:48px;color:#fff;background:linear-gradient(63.44deg,#1d2939 16.72%,#475467 83.39%);border-radius:32px;-webkit-user-select:none;user-select:none;font-size:14px;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Oxygen,Ubuntu,Cantarell,Open Sans,Helvetica Neue,sans-serif;cursor:default;transition:all .3s ease-in-out}._container_36akj_7 *{box-sizing:border-box}._overlay_36akj_27{position:fixed;z-index:9999998;left:0;right:0;top:0;bottom:0;-webkit-user-select:none;user-select:none;transition:all .3s ease-in-out}._overlay_36akj_27._masking_36akj_37{-webkit-user-select:all;user-select:all;-webkit-backdrop-filter:brightness(66%) blur(4px);backdrop-filter:brightness(66%) blur(4px)}._controller_36akj_41{position:absolute;margin-left:8px;opacity:0;transition:all .3s ease-in-out}._countdown_36akj_47{position:absolute;opacity:0;transition:all .5s ease-in-out}._messageBox_36akj_52{position:absolute;left:0;right:0;top:0;bottom:0;opacity:0;pointer-events:none;transition:all .24s ease-in-out}._handleBar_36akj_62{display:flex;flex-wrap:wrap;position:absolute;right:16px;width:24px;height:24px;padding:2px 4px;pointer-events:none;cursor:move;opacity:0;transition:opacity .3s ease-in-out}._handleBar_36akj_62 ._dot_36akj_78{display:flex;align-items:center;justify-content:center;flex-grow:0;flex-shrink:0;width:50%;height:33%}._handleBar_36akj_62 ._dot_36akj_78>div{width:3px;height:3px;border-radius:100%;background:#d9d9d9}._initial_36akj_93._container_36akj_7{opacity:0;transform:translateY(-100px)}._countingDown_36akj_97._container_36akj_7{width:216px;height:268px;border-radius:24px;transition:all .5s ease-in-out}._countingDown_36akj_97._container_36akj_7._center_36akj_103{transform:translate(-40px)}._countingDown_36akj_97._container_36akj_7 ._controller_36akj_41 ::global(._stopButton_36akj_106){transform:translate(200px) scale(7)}._countingDown_36akj_97._container_36akj_7 ._countdown_36akj_47{opacity:1;transform:none}._recording_36akj_113._container_36akj_7{justify-content:flex-start;transition:all .3s ease-in-out}._recording_36akj_113._container_36akj_7 ._controller_36akj_41{opacity:1}._recording_36akj_113._container_36akj_7 ._countdown_36akj_47{transform:scale(.3) translate(-200px,-20px)}._recording_36akj_113._container_36akj_7 ._handleBar_36akj_62{opacity:.5;pointer-events:all}._recording_36akj_113._container_36akj_7 ._handleBar_36akj_62:hover{opacity:1}._mini_36akj_130._container_36akj_7{overflow:hidden;width:64px;height:32px;border-radius:24px;background:linear-gradient(63.44deg,#1d2939 16.72%,#475467 83.39%);transition:all .4s ease-in-out}._mini_36akj_130._container_36akj_7.recording{animation:1.2s infinite alternate _mini-recorder-controller-animation_36akj_1}._mini_36akj_130._container_36akj_7._center_36akj_103{transform:translate(36px)}._mini_36akj_130._container_36akj_7 ._controller_36akj_41{opacity:1}._message_36akj_52._container_36akj_7{width:300px;height:140px;border-radius:24px}._message_36akj_52._container_36akj_7._center_36akj_103{transform:translate(-82px)}._message_36akj_52._container_36akj_7 ._messageBox_36akj_52{opacity:1;pointer-events:all}@keyframes _mini-recorder-controller-animation_36akj_1{0%{background:#f04438}70%{background:#d92d20}to{background:#f04438}}._dragContainer_36akj_170{position:absolute;top:0;left:0;right:0;bottom:0;z-index:9999997}</style><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/45bf68c.js" class=""></script><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/ebeadbc.js" class=""></script><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/099fdec.js" class=""></script><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/ca7277e.js" class=""></script><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/4fafc9f.js" class=""></script><style id="fusion-selection-styles" class="">
  .fusion-element-highlight {
    outline: 2px solid #6366f1 !important;
    outline-style: solid !important;
  }
  
  .fusion-element-selected {
    outline: 5px solid #10b981 !important;
    outline-style: solid !important;
    outline-offset: 3px !important;
    animation: fusion-selected-pulse 2s ease-in-out infinite !important;
  }
  
  @keyframes fusion-selected-pulse {
    0% { 
      outline-color: #10b981 !important;
      outline-width: 5px !important;
      outline-offset: 3px !important;
    }
    50% { 
      outline-color: #059669 !important;
      outline-width: 6px !important;
      outline-offset: 4px !important;
    }
    100% { 
      outline-color: #10b981 !important;
      outline-width: 5px !important;
      outline-offset: 3px !important;
    }
  }
  
  .fusion-selection-overlay {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    background: rgba(0, 0, 0, 0.05) !important;
    z-index: 2147483647 !important;
    cursor: crosshair !important;
    pointer-events: none !important;
  }
  
  .fusion-selection-tooltip {
    position: fixed !important;
    background: #1f2937 !important;
    color: white !important;
    padding: 8px 12px !important;
    border-radius: 6px !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    z-index: 2147483648 !important;
    pointer-events: none !important;
    transform: translate(-50%, -100%) translateY(-10px) !important;
    white-space: nowrap !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
  }
  
  .fusion-selection-tooltip::after {
    content: '' !important;
    position: absolute !important;
    top: 100% !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    border: 5px solid transparent !important;
    border-top-color: #1f2937 !important;
  }
  
  
  @keyframes fusion-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  @keyframes fusion-label-bounce {
    0% { 
      opacity: 0;
      transform: translateY(-10px) scale(0.9);
    }
    50% {
      opacity: 1;
      transform: translateY(0) scale(1.05);
    }
    100% { 
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/20.7c63bf5.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/00ab150.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/33.1ea2750.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/86a57f4.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/46.71ee17b.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/4615a56.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/41.4007e24.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/d413fa7.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/42.1bb0a10.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/8ae639f.js" class=""></script><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/5ac29e5.js" class=""></script><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/ff579fd.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/45.9c56b68.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/171d5e3.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/44.76340c8.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/832178f.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/34.f6517d5.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/36487e3.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/15.26cc803.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/494aca0.js" class=""></script><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/802f721.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/31.e76d9cc.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/d9fd32b.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/32.9f6dadc.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/d515c7a.js" class=""></script><style class="">.main-container > .column-view > .recommended-links.main-area{
  margin-top: 1.5rem;
}</style><script src="//unpkg.byted-static.com/byted-juejin/component-runtime/0.2.2/dist/index.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/40.ddd7c99.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/9986bc1.js" class=""></script><link rel="preload" as="style" href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/43.f51e632.css" class=""><script charset="utf-8" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/1ddae5b.js" class=""></script><script crossorigin="anonymous" src="https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter/1.0.0.264/index.js" class=""></script><script src="https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter-collect/1.0.0.8-5.1.16/collect-base.js" async="" class=""></script><script src="https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter-collect/1.0.0.8-5.1.16/collect-base.js" async="" class=""></script><script src="https://lf3-short.ibytedapm.com/slardar/fe/sdk-web/plugins/common-monitors.1.1.6.js" crossorigin="anonymous" class=""></script><script src="https://lf3-short.ibytedapm.com/slardar/fe/sdk-web/plugins/blank-screen.1.1.6.js" crossorigin="anonymous" class=""></script><script src="https://lf3-short.ibytedapm.com/slardar/fe/sdk-web/plugins/common-monitors.1.16.3.js" crossorigin="anonymous" class=""></script><style id="__h2d_pseudo_disable">.__h2d-remove-before:before,.__h2d-remove-after:after{content:none!important}</style></head>
  <body data-theme="light" class="">
    <script data-n-head="ssr" type="text/javascript" data-pbody="true" class="">(function () {
    const pages = [
        /^\/$/,
        /^\/following$/,
        /^\/recommended$/,
        '^/pins.*',
        '^/pin.*',
        /^\/course(?!\/payment\/)/,
        /^\/post\/.*/,
        '^/hot.*',
        /^\/book\/\d+/,
        /^\/video\/\d+/,
        /^\/user\/settings.*/,
        /^\/spost\/\d+/,
        /^\/notification(?!\/im)/,
        '^/backend',
        '^/frontend',
        '^/android',
        '^/ios',
        '^/ai',
        '^/freebie',
        '^/career',
        '^/article',
        '^/player',
    ];
    function isInJuejinApp() {
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        return /juejin/i.test(userAgent);
    }
    if (typeof window !== 'undefined' && !isInJuejinApp()) {
        try {
            const path = window.location.pathname;
            const isAvailable = pages.some((page) => {
                const reg = new RegExp(page);
                return reg.test(path);
            });
            if (isAvailable) {
                const localValue = localStorage.getItem('juejin_2608_theme') || '{}';
                let { theme = 'light', isFollowSystem = false } = JSON.parse(localValue);
                if (isFollowSystem) {
                    const themeMedia = window.matchMedia('(prefers-color-scheme: light)');
                    theme = themeMedia.matches ? 'light' : 'dark';
                    localStorage.setItem('juejin_2608_theme', JSON.stringify({ theme, isFollowSystem }));
                }
                document.body.setAttribute('data-theme', theme);
            }
            else {
                document.body.setAttribute('data-theme', 'light');
            }
        }
        catch (e) {
            console.error('浏览器不支持localStorage');
        }
    }
})()</script><div id="__nuxt" class=""><div id="__layout" class=""><div id="juejin" class=""><div class="container index-container" data-v-539963b4="" data-v-6dc27796=""><div class="view-container" data-v-539963b4=""><div data-v-539963b4="" class="top-banners-container"><!----> <!----></div> <header data-fetch-key="data-v-0d14266a:0" class="main-header main-header unauthorized visible" data-v-0d14266a="" data-v-539963b4=""><div class="container" data-v-0d14266a=""><a rel="noreferrer" class="logo" data-v-0d14266a=""><img src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/e08da34488b114bd4c665ba2fa520a31.svg" alt="稀土掘金" class="logo-img" data-v-0d14266a=""> <img src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/6c61ae65d1c41ae8221a670fa32d05aa.svg" alt="稀土掘金" class="mobile" data-v-0d14266a=""></a> <!----> <nav role="navigation" class="main-nav" data-v-0d14266a=""><ul class="nav-list" data-v-0d14266a=""><!----> <li class="main-nav-list" data-v-0d14266a=""><div data-v-0d14266a="" class="phone-show-menu"><span data-v-0d14266a="" class="">首页</span> <!----></div> <ul class="phone-hide" data-v-0d14266a=""><li class="nav-item link-item active" data-v-0d14266a=""><a href="/" data-v-0d14266a="" class="">首页</a></li> <li class="nav-item link-item activities" data-v-0d14266a=""><a href="https://aicoding.juejin.cn" data-v-0d14266a="" class="">
                AI Coding
                <span class="new-font" data-v-0d14266a="">NEW</span></a></li> <li class="nav-item link-item activities" data-v-0d14266a=""><a href="/pins" data-v-0d14266a="" class="">
                沸点
                <span class="text" data-v-0d14266a=""></span></a></li> <li class="nav-item link-item book" data-v-0d14266a=""><a href="/course" data-v-0d14266a="" class="">
                课程
                </a></li> <li class="nav-item link-item" data-v-0d14266a=""><a href="/live" data-v-0d14266a="" class="">
                直播
              </a></li> <li class="nav-item link-item" data-v-0d14266a=""><a href="/events/all" data-v-0d14266a="" class="">
                活动
              </a></li> <li class="nav-item link-item" data-v-0d14266a=""><a href="/problemset" data-v-0d14266a="" class="">
                AI刷题
              </a></li> <nav class="nav-item link-item download-icon" data-v-0d14266a=""><a href="/app?utm_source=jj_nav" target="_blank" class="download-app no-border" data-v-0d14266a="">
                APP
              </a></nav> <nav class="nav-item link-item extension-icon" data-v-0d14266a=""><a href="https://juejin.cn/extension?utm_source=jj_nav" target="_blank" rel="nofollow noopener noreferrer" class="jj-link broswer-extension no-border" data-v-65b50b51="" data-v-0d14266a=""><span data-v-65b50b51="" data-v-0d14266a="" class="">插件</span></a></nav> <!----></ul></li> <ul class="right-side-nav" data-v-0d14266a=""><li class="search-add" data-v-0d14266a=""><ul class="search-add-ul" data-v-0d14266a=""><li class="nav-item search" data-v-0d14266a=""><form role="search" class="search-form" data-v-0d14266a=""><input type="search" maxlength="64" placeholder="探索稀土掘金" value="" class="search-input" data-v-0d14266a="" __h2d_shadowroot="191"> <div class="seach-icon-container" data-v-0d14266a=""><svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" class="search-icon" data-v-0d14266a=""><path d="M12.4008 12.4008C14.744 10.0577 14.744 6.25871 12.4008 3.91556C10.0577 1.57242 6.25871 1.57242 3.91556 3.91556C1.57242 6.25871 1.57242 10.0577 3.91556 12.4008C6.25871 14.744 10.0577 14.744 12.4008 12.4008ZM12.4008 12.4008L15.5828 15.5828" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" data-v-0d14266a=""></path></svg></div> <!----> <div class="typehead" style="display:none;" data-v-0d14266a=""><!----> <div class="title" data-v-0d14266a=""><span data-v-0d14266a="" class="">搜索历史</span> <span class="clear" data-v-0d14266a="">
                        清空
                      </span></div> <div class="list" data-v-0d14266a=""></div></div></form></li> <!----> <li class="nav-item add creator-item" data-v-0d14266a=""><div class="add-group" data-v-222d7b0f="" data-v-0d14266a=""><!----> <button class="add-btn" data-v-222d7b0f="">
    创作者中心
  </button> <div class="more" data-v-222d7b0f=""><svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="unfold12-icon" data-v-222d7b0f=""><path d="M2.45025 4.82383C2.17422 4.49908 2.40501 4 2.83122 4H9.16878C9.59499 4 9.82578 4.49908 9.54975 4.82382L6.38097 8.5518C6.1813 8.7867 5.8187 8.7867 5.61903 8.5518L2.45025 4.82383Z" fill="white" data-v-222d7b0f=""></path></svg> <div class="more-mask" data-v-222d7b0f=""></div> <div class="more-list" data-v-222d7b0f=""><ul class="menu" data-v-222d7b0f=""><li class="item" data-v-222d7b0f=""><div class="icon write-article" data-v-222d7b0f=""></div> <div class="title" data-v-222d7b0f="">写文章</div></li><li class="item" data-v-222d7b0f=""><div class="icon issue-points" data-v-222d7b0f=""></div> <div class="title" data-v-222d7b0f="">发沸点</div></li><li class="item" data-v-222d7b0f=""><div class="icon write-note" data-v-222d7b0f=""></div> <div class="title" data-v-222d7b0f="">写笔记</div></li><li class="item" data-v-222d7b0f=""><div class="icon create-jcode" data-v-222d7b0f=""></div> <div class="title" data-v-222d7b0f="">写代码</div></li><li class="item" data-v-222d7b0f=""><div class="icon drafts" data-v-222d7b0f=""></div> <div class="title" data-v-222d7b0f="">草稿箱</div></li></ul> <div class="divider" data-v-222d7b0f=""></div> <div class="inspiration" data-v-222d7b0f=""><div class="info" data-v-222d7b0f=""><span class="title" data-v-222d7b0f="">创作灵感</span> <span class="more-info" data-v-222d7b0f="">
            查看更多
            <i class="icon byte-icon byte-icon--right" data-v-222d7b0f=""><svg t="1561636167146" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="404349" xmlns:xlink="http://www.w3.org/1999/xlink"><path d="M630.4 512L283.52 165.12a21.12 21.12 0 0 1 0-30.08l30.08-30.08a21.12 21.12 0 0 1 30.08 0l377.6 376.96a42.24 42.24 0 0 1 0 60.16l-377.6 376.96a21.12 21.12 0 0 1-30.08 0l-30.08-30.08a21.12 21.12 0 0 1 0-30.08z" p-id="404350"></path></svg></i></span></div> <div class="list" data-v-222d7b0f=""> <div data-v-222d7b0f="" class="item"><span data-v-222d7b0f="" class="icon icon-topic">话题</span> <span data-v-222d7b0f="" class="title topic-title">金石焕新程</span></div><div data-v-222d7b0f="" class="item"><span data-v-222d7b0f="" class="icon icon-topic">话题</span> <span data-v-222d7b0f="" class="title topic-title">MCP 怎么玩</span></div><div data-v-222d7b0f="" class="item"><span data-v-222d7b0f="" class="icon icon-topic">话题</span> <span data-v-222d7b0f="" class="title topic-title">每天一个知识点</span></div> <div class="item" data-v-21339fef="" data-v-222d7b0f=""></div></div></div></div></div> </div></li></ul></li> <li class="nav-item vip-entry" data-v-0d14266a=""><div class="vip-title" data-v-0d14266a=""><div class="vip-entry-img" data-v-0d14266a=""><img src="https://p9-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/ffd3e238ee7f46eab42bf88af17f5528~tplv-k3u1fbpfcp-image.image#?w=25&amp;h=26&amp;s=5968&amp;e=svg&amp;a=1&amp;b=dacbbc" alt="vip" class="vip-img" data-v-0d14266a=""> </div> <div class="vip-words" data-v-0d14266a="">会员</div></div></li> <!---->  <!----> <li class="nav-item auth" data-v-0d14266a=""><div class="login-button-wrap" data-v-0d14266a=""><button class="login-button" data-v-0d14266a="">
                登录
                <div class="login-button-inner" data-v-0d14266a=""><div class="login-button-line" data-v-0d14266a=""></div>
                  注册
                </div></button> <div data-v-0d14266a="" class="login-popover" style="display: none;"><div data-v-89938ab0="" data-v-0d14266a="" class="top-login-guide"><div data-v-89938ab0="" class="login-awards"><h2 data-v-89938ab0="" class="login-awards-title">首次登录 / 注册免费领取</h2> <ul data-v-89938ab0="" class="login-awards-list"></ul></div> <span data-v-89938ab0="" class="login-awards-desc">
    
  </span> <button data-v-89938ab0="" class="login-btn">登录 / 注册</button></div></div></div></li></ul></ul></nav></div></header>  <main class="container main-container" data-v-539963b4=""><div class="view timeline-index-view" data-v-539963b4="" data-v-6dc27796=""><div class="index-nav" data-v-539963b4="" data-v-6dc27796=""><nav class="side-navigator-wrap" data-v-96636f7c="" data-v-6dc27796="" data-v-539963b4=""><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content" data-v-96636f7c=""><a href="/following" class="nav-item" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><path d="M11.5903 8.19043C11.5542 8.11425 11.4458 8.11425 11.4097 8.19043L10.4041 10.31C10.3898 10.3401 10.3615 10.3611 10.3287 10.366L8.19408 10.6887C8.11329 10.7009 8.08045 10.7996 8.13783 10.8578L9.68325 12.4248C9.70571 12.4476 9.71592 12.4798 9.71072 12.5113L9.33377 14.7975C9.32021 14.8798 9.4073 14.9415 9.48042 14.9015L11.452 13.8233C11.4819 13.8069 11.5181 13.8069 11.548 13.8233L13.5196 14.9015C13.5927 14.9415 13.6798 14.8798 13.6662 14.7975L13.2893 12.5113C13.2841 12.4798 13.2943 12.4476 13.3168 12.4248L14.8622 10.8578C14.9195 10.7996 14.8867 10.7009 14.8059 10.6887L12.6713 10.366C12.6385 10.3611 12.6102 10.3401 12.5959 10.31L11.5903 8.19043Z" fill="currentColor" data-v-6dc27796=""></path><path fill-rule="evenodd" clip-rule="evenodd" d="M12.7568 1.3335C13.4239 1.3335 13.9641 1.86183 13.9983 2.52111L14 2.58746V6.34783V9.44263L13.7881 9.41059C13.6565 9.39071 13.5435 9.30673 13.4865 9.18654L11.8614 5.76125C11.7168 5.45652 11.2832 5.45652 11.1386 5.76125L9.51354 9.18654C9.45652 9.30673 9.34347 9.39071 9.21193 9.41059L5.77633 9.92991C5.45315 9.97876 5.32181 10.3736 5.55131 10.6063L8.04943 13.1394C8.13927 13.2305 8.18011 13.3591 8.1593 13.4853L7.90953 15.0002H5.42606H3.24324C2.57608 15.0002 2.03587 14.4718 2.00171 13.8125L2 13.7462V2.58746C2 1.91989 2.51869 1.37002 3.17696 1.33524L3.24324 1.3335H12.7568ZM7.33333 7.00017C7.33333 6.81608 7.18409 6.66684 7 6.66684H5C4.8159 6.66684 4.66666 6.81608 4.66666 7.00017V7.66684C4.66666 7.85093 4.8159 8.00017 5 8.00017H7C7.18409 8.00017 7.33333 7.85093 7.33333 7.66684V7.00017ZM9.66666 4.00017C9.85076 4.00017 10 4.14941 10 4.3335V5.00017C10 5.18426 9.85076 5.3335 9.66666 5.3335H5C4.8159 5.3335 4.66666 5.18426 4.66666 5.00017V4.3335C4.66666 4.14941 4.8159 4.00017 5 4.00017H9.66666Z" fill="currentColor" data-v-6dc27796=""></path></svg> <span class="nav-item-text" data-v-96636f7c="">
          关注
          <!----></span></a> <!----></div> <!----></div><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content" data-v-96636f7c=""><a href="/recommended" class="nav-item" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><path fill-rule="evenodd" clip-rule="evenodd" d="M0.666016 8.00033C0.666016 12.0504 3.94926 15.3337 7.99935 15.3337C12.0494 15.3337 15.3327 12.0504 15.3327 8.00033C15.3327 3.95024 12.0494 0.666992 7.99935 0.666992C3.94926 0.666992 0.666016 3.95024 0.666016 8.00033ZM5.43709 11.0048L9.3392 9.34286L11.0037 5.43876C11.0397 5.35428 11.0393 5.25869 11.0025 5.17455C10.9288 5.00586 10.7323 4.92887 10.5636 5.00259L6.68535 6.69744L5.00087 10.565C4.96428 10.649 4.96389 10.7444 4.9998 10.8287C5.07193 10.9981 5.26772 11.0769 5.43709 11.0048Z" fill="currentColor" data-v-6dc27796=""></path></svg> <span class="nav-item-text" data-v-96636f7c="">
          综合
          <!----></span></a> <!----></div> <!----></div><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content" data-v-96636f7c=""><a href="/backend" class="nav-item" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><path fill-rule="evenodd" clip-rule="evenodd" d="M2 2C1.44772 2 1 2.44772 1 3V11C1 11.5523 1.44772 12 2 12H14C14.5523 12 15 11.5523 15 11V3C15 2.44772 14.5523 2 14 2H2ZM4.5 7C4.22386 7 4 7.22386 4 7.5V9.5C4 9.77614 4.22386 10 4.5 10H5C5.27614 10 5.5 9.77614 5.5 9.5V7.5C5.5 7.22386 5.27614 7 5 7H4.5ZM7 5C7 4.72386 7.22386 4.5 7.5 4.5H8C8.27614 4.5 8.5 4.72386 8.5 5V9.5C8.5 9.77614 8.27614 10 8 10H7.5C7.22386 10 7 9.77614 7 9.5V5ZM10.5 6C10.2239 6 10 6.22386 10 6.5V9.5C10 9.77614 10.2239 10 10.5 10H11C11.2761 10 11.5 9.77614 11.5 9.5V6.5C11.5 6.22386 11.2761 6 11 6H10.5Z" fill="currentColor" data-v-6dc27796=""></path><rect x="3" y="13" width="10" height="1.3" rx="0.5" fill="currentColor" data-v-6dc27796=""></rect></svg> <span class="nav-item-text" data-v-96636f7c="">
          后端
          <!----></span></a> <!----></div> <!----></div><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content" data-v-96636f7c=""><a href="/frontend" class="nav-item" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><path fill-rule="evenodd" clip-rule="evenodd" d="M2 2C1.44772 2 1 2.44772 1 3V6H15V3C15 2.44772 14.5523 2 14 2H2ZM15 7.3H1V13C1 13.5523 1.44772 14 2 14H14C14.5523 14 15 13.5523 15 13V7.3ZM8.65811 8.02566C8.92009 8.11298 9.06167 8.39614 8.97434 8.65811L7.97434 11.6581C7.88702 11.9201 7.60386 12.0617 7.34189 11.9743C7.07991 11.887 6.93833 11.6039 7.02566 11.3419L8.02566 8.34189C8.11298 8.07991 8.39614 7.93833 8.65811 8.02566ZM3.5 5C3.77614 5 4 4.77614 4 4.5C4 4.22386 3.77614 4 3.5 4C3.22386 4 3 4.22386 3 4.5C3 4.77614 3.22386 5 3.5 5ZM5.5 4.5C5.5 4.77614 5.27614 5 5 5C4.72386 5 4.5 4.77614 4.5 4.5C4.5 4.22386 4.72386 4 5 4C5.27614 4 5.5 4.22386 5.5 4.5ZM6.5 5C6.77614 5 7 4.77614 7 4.5C7 4.22386 6.77614 4 6.5 4C6.22386 4 6 4.22386 6 4.5C6 4.77614 6.22386 5 6.5 5ZM6.44721 8.77639C6.57071 9.02338 6.4706 9.32372 6.22361 9.44721L5.11803 10L6.22361 10.5528C6.4706 10.6763 6.57071 10.9766 6.44721 11.2236C6.32372 11.4706 6.02338 11.5707 5.77639 11.4472L3.77639 10.4472C3.607 10.3625 3.5 10.1894 3.5 10C3.5 9.81061 3.607 9.63748 3.77639 9.55279L5.77639 8.55279C6.02338 8.42929 6.32372 8.5294 6.44721 8.77639ZM9.77639 9.44721C9.5294 9.32372 9.42929 9.02338 9.55279 8.77639C9.67628 8.5294 9.97662 8.42929 10.2236 8.55279L12.2236 9.55279C12.393 9.63748 12.5 9.81061 12.5 10C12.5 10.1894 12.393 10.3625 12.2236 10.4472L10.2236 11.4472C9.97662 11.5707 9.67628 11.4706 9.55279 11.2236C9.42929 10.9766 9.5294 10.6763 9.77639 10.5528L10.882 10L9.77639 9.44721Z" fill="currentColor" data-v-6dc27796=""></path></svg> <span class="nav-item-text" data-v-96636f7c="">
          前端
          <!----></span></a> <!----></div> <!----></div><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content" data-v-96636f7c=""><a href="/android" class="nav-item" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><rect x="5.69922" y="12" width="1.3" height="3" rx="0.5" fill="currentColor" data-v-6dc27796=""></rect><rect x="1" y="6" width="1.3" height="6" rx="0.5" fill="currentColor" data-v-6dc27796=""></rect><rect x="13.6992" y="6" width="1.3" height="6" rx="0.5" fill="currentColor" data-v-6dc27796=""></rect><rect x="9" y="12" width="1.3" height="3" rx="0.5" fill="currentColor" data-v-6dc27796=""></rect><path fill-rule="evenodd" clip-rule="evenodd" d="M13 5.36364V12C13 12.5523 12.5523 13 12 13H4C3.44772 13 3 12.5523 3 12V5.36364V5.27273C3 5.24067 3.00151 5.20897 3.00446 5.17768C3.11608 2.85397 5.30996 1 8 1C10.69 1 12.8839 2.85397 12.9955 5.17768C12.9985 5.20897 13 5.24067 13 5.27273V5.36364ZM7 5.75C7 6.16421 6.66421 6.5 6.25 6.5C5.83579 6.5 5.5 6.16421 5.5 5.75C5.5 5.33579 5.83579 5 6.25 5C6.66421 5 7 5.33579 7 5.75ZM9.75 6.5C10.1642 6.5 10.5 6.16421 10.5 5.75C10.5 5.33579 10.1642 5 9.75 5C9.33579 5 9 5.33579 9 5.75C9 6.16421 9.33579 6.5 9.75 6.5Z" fill="currentColor" data-v-6dc27796=""></path></svg> <span class="nav-item-text" data-v-96636f7c="">
          Android
          <!----></span></a> <!----></div> <!----></div><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content" data-v-96636f7c=""><a href="/ios" class="nav-item" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><path d="M11.822 8.4388C11.8045 6.66562 13.268 5.81556 13.3331 5.77312C12.5106 4.56956 11.2296 4.40506 10.7733 4.38581C9.68308 4.27556 8.64621 5.02763 8.09277 5.02763C7.54108 5.02763 6.68708 4.402 5.78277 4.41863C4.59452 4.43613 3.49858 5.10944 2.88696 6.17387C1.65233 8.3163 2.57064 11.4899 3.77421 13.2277C4.36221 14.0782 5.06352 15.0332 5.98402 14.9991C6.87039 14.9637 7.20596 14.4255 8.27739 14.4255C9.34883 14.4255 9.65027 14.9991 10.5887 14.9816C11.5425 14.9637 12.1471 14.1149 12.7311 13.2618C13.4062 12.2752 13.6845 11.3197 13.7006 11.2707C13.6796 11.2611 11.8404 10.5567 11.822 8.4388ZM10.0593 3.23563C10.548 2.64281 10.8779 1.82031 10.7878 1C10.0838 1.02888 9.23071 1.469 8.72583 2.06006C8.27258 2.58463 7.87621 3.422 7.98252 4.22613C8.76827 4.28737 9.57021 3.82669 10.0593 3.23563Z" fill="currentColor" data-v-6dc27796=""></path></svg> <span class="nav-item-text" data-v-96636f7c="">
          iOS
          <!----></span></a> <!----></div> <!----></div><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content active-nav" data-v-96636f7c=""><a href="/ai" aria-current="page" class="nav-item router-link-exact-active route-active" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><rect x="1" y="8" width="1.3" height="5" rx="0.5" fill="currentColor" data-v-6dc27796=""></rect><rect x="14" y="8" width="1.3" height="5" rx="0.5" fill="currentColor" data-v-6dc27796=""></rect><rect x="7.5" y="4" width="1" height="3" rx="0.5" fill="currentColor" data-v-6dc27796=""></rect><circle cx="8" cy="2" r="1" fill="currentColor" data-v-6dc27796=""></circle><path fill-rule="evenodd" clip-rule="evenodd" d="M3 7C3 6.44772 3.44772 6 4 6H12C12.5523 6 13 6.44772 13 7V14C13 14.5523 12.5523 15 12 15H4C3.44772 15 3 14.5523 3 14V7ZM7 10.75C7 11.1642 6.66421 11.5 6.25 11.5C5.83579 11.5 5.5 11.1642 5.5 10.75C5.5 10.3358 5.83579 10 6.25 10C6.66421 10 7 10.3358 7 10.75ZM9.75 11.5C10.1642 11.5 10.5 11.1642 10.5 10.75C10.5 10.3358 10.1642 10 9.75 10C9.33579 10 9 10.3358 9 10.75C9 11.1642 9.33579 11.5 9.75 11.5Z" fill="currentColor" data-v-6dc27796=""></path></svg> <span class="nav-item-text" data-v-96636f7c="">
          人工智能
          <!----></span></a> <!----></div> <!----></div><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content" data-v-96636f7c=""><a href="/freebie" class="nav-item" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><g clip-path="url(#clip0_20616_81506)" data-v-6dc27796=""><path d="M14.212 4.54986L13.497 5.26886C13.3158 5.45088 13.1005 5.59531 12.8633 5.69386C12.6261 5.79242 12.3718 5.84315 12.115 5.84315C11.8582 5.84315 11.6039 5.79242 11.3667 5.69386C11.1295 5.59531 10.9142 5.45088 10.733 5.26886C10.3664 4.89915 10.1606 4.39955 10.1606 3.87886C10.1606 3.35817 10.3664 2.85857 10.733 2.48886L11.448 1.76986C11.843 1.37286 11.579 0.90486 10.868 1.01686C10.028 1.14786 9.262 1.57586 8.709 2.22286C8.005 2.91786 7.682 4.16486 7.922 5.31786L1.927 11.3469C1.56096 11.7165 1.35562 12.2157 1.35562 12.7359C1.35562 13.2561 1.56096 13.7552 1.927 14.1249C2.10804 14.307 2.32329 14.4515 2.56038 14.5501C2.79747 14.6487 3.05172 14.6995 3.3085 14.6995C3.56528 14.6995 3.81953 14.6487 4.05662 14.5501C4.29371 14.4515 4.50896 14.307 4.69 14.1249L10.686 8.09486C11.2693 8.2189 11.8745 8.19473 12.446 8.02459C13.0176 7.85444 13.5375 7.54373 13.958 7.12086C14.5581 6.51861 14.9243 5.72244 14.991 4.87486C15.071 4.41886 14.607 4.15286 14.212 4.54986ZM3.768 13.1979C3.67659 13.2885 3.56041 13.35 3.4341 13.3747C3.30779 13.3994 3.17699 13.3861 3.05819 13.3366C2.93939 13.2871 2.8379 13.2036 2.76651 13.0965C2.69511 12.9894 2.65701 12.8636 2.657 12.7349C2.65647 12.5618 2.72462 12.3957 2.84649 12.2729C2.96836 12.1501 3.13399 12.0807 3.307 12.0799C3.487 12.0799 3.651 12.1529 3.768 12.2719C3.888 12.3889 3.96 12.5539 3.96 12.7349C3.9604 12.8209 3.94363 12.9062 3.91066 12.9857C3.87769 13.0652 3.82919 13.1373 3.768 13.1979ZM3.118 4.66786L5.377 6.93986L6.297 6.01286L4.04 3.74286L3.535 2.77086L1.92 1.61186L1 2.53986L2.151 4.16086L3.118 4.66786ZM10.672 9.48586C10.642 9.45526 10.6062 9.43095 10.5667 9.41436C10.5272 9.39776 10.4848 9.38921 10.442 9.38921C10.3992 9.38921 10.3568 9.39776 10.3173 9.41436C10.2778 9.43095 10.242 9.45526 10.212 9.48586L8.83 10.8759C8.79955 10.9062 8.7754 10.9423 8.75891 10.982C8.74243 11.0218 8.73395 11.0644 8.73395 11.1074C8.73395 11.1504 8.74243 11.193 8.75891 11.2327C8.7754 11.2724 8.79955 11.3085 8.83 11.3389L12.09 14.6169C12.2106 14.7383 12.3541 14.8348 12.5122 14.9006C12.6703 14.9663 12.8398 15.0002 13.011 15.0002C13.1822 15.0002 13.3517 14.9663 13.5098 14.9006C13.6679 14.8348 13.8114 14.7383 13.932 14.6169C14.442 14.1049 14.442 13.2769 13.932 12.7639L10.672 9.48586Z" fill="currentColor" data-v-6dc27796=""></path></g><defs data-v-6dc27796=""><clipPath id="clip0_20616_81506" data-v-6dc27796=""><rect width="14" height="14" fill="white" transform="translate(1 1)" data-v-6dc27796=""></rect></clipPath></defs></svg> <span class="nav-item-text" data-v-96636f7c="">
          开发工具
          <!----></span></a> <!----></div> <!----></div><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content" data-v-96636f7c=""><a href="/career" class="nav-item" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><path fill-rule="evenodd" clip-rule="evenodd" d="M1 2C1 1.44772 1.44772 1 2 1H14C14.5523 1 15 1.44772 15 2V14C15 14.5523 14.5523 15 14 15H2C1.44772 15 1 14.5523 1 14V2ZM3 4.5C3 4.22386 3.22386 4 3.5 4H12.5C12.7761 4 13 4.22386 13 4.5V4.8C13 5.07614 12.7761 5.3 12.5 5.3H3.5C3.22386 5.3 3 5.07614 3 4.8V4.5ZM3.5 7C3.22386 7 3 7.22386 3 7.5V7.8C3 8.07614 3.22386 8.3 3.5 8.3H4.5C4.77614 8.3 5 8.07614 5 7.8V7.5C5 7.22386 4.77614 7 4.5 7H3.5ZM7 7.5C7 7.22386 7.22386 7 7.5 7H8.5C8.77614 7 9 7.22386 9 7.5V7.8C9 8.07614 8.77614 8.3 8.5 8.3H7.5C7.22386 8.3 7 8.07614 7 7.8V7.5ZM11.5 7C11.2239 7 11 7.22386 11 7.5V7.8C11 8.07614 11.2239 8.3 11.5 8.3H12.5C12.7761 8.3 13 8.07614 13 7.8V7.5C13 7.22386 12.7761 7 12.5 7H11.5ZM3 10.5C3 10.2239 3.22386 10 3.5 10H7.5C7.77614 10 8 10.2239 8 10.5V10.8C8 11.0761 7.77614 11.3 7.5 11.3H3.5C3.22386 11.3 3 11.0761 3 10.8V10.5ZM10.5 10C10.2239 10 10 10.2239 10 10.5V10.8C10 11.0761 10.2239 11.3 10.5 11.3H12.5C12.7761 11.3 13 11.0761 13 10.8V10.5C13 10.2239 12.7761 10 12.5 10H10.5Z" fill="currentColor" data-v-6dc27796=""></path></svg> <span class="nav-item-text" data-v-96636f7c="">
          代码人生
          <!----></span></a> <!----></div> <!----></div><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content" data-v-96636f7c=""><a href="/article" class="nav-item" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><path fill-rule="evenodd" clip-rule="evenodd" d="M14.9187 6.53385C15.0999 6.76744 14.9466 7.2 14.651 7.2H6.32905V4H5.02905V7.2H3.6C2.16406 7.2 1 6.03594 1 4.6C1 3.16406 2.16406 2 3.6 2H14.651C14.9466 2 15.0999 2.43257 14.9188 2.66616C14.5064 3.19779 14.2602 3.86959 14.2602 4.60001C14.2602 5.33043 14.5064 6.00222 14.9187 6.53385Z" fill="currentColor" data-v-6dc27796=""></path><path fill-rule="evenodd" clip-rule="evenodd" d="M1.34902 13.9998C1.0534 13.9998 0.900077 13.5672 1.08126 13.3337C1.49363 12.802 1.7398 12.1302 1.7398 11.3998C1.7398 10.6694 1.49362 9.9976 1.08125 9.46597C0.900064 9.23238 1.05339 8.7998 1.34901 8.7998H12.4C13.8359 8.7998 15 9.96386 15 11.3998C15 12.8357 13.8359 13.9998 12.4 13.9998H1.34902Z" fill="currentColor" data-v-6dc27796=""></path></svg> <span class="nav-item-text" data-v-96636f7c="">
          阅读
          <!----></span></a> <!----></div> <!----></div><div class="nav-item-wrap" data-v-96636f7c=""><div class="nav-item-content" data-v-96636f7c=""><a href="/hot/articles" target="_blank" class="nav-item" data-v-96636f7c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-6dc27796="" class=""><g clip-path="url(#clip0_24309_94629)" data-v-6dc27796=""><path d="M2.35 0C2.01863 0 1.75 0.26863 1.75 0.600001V1.63198H14.2461V0.6C14.2461 0.268629 13.9775 0 13.6461 0H2.35Z" fill="url(#paint0_linear_24309_94629)" data-v-6dc27796=""></path><path fill-rule="evenodd" clip-rule="evenodd" d="M1.75 2.69531H14.2461V15.4096C14.2461 15.834 13.8174 16.1243 13.4233 15.9666L8.18375 13.8708C8.06455 13.8231 7.93157 13.8231 7.81236 13.8708L2.57283 15.9666C2.17871 16.1243 1.75 15.834 1.75 15.4096V2.69531ZM7.81614 5.6642C7.88951 5.51555 8.10148 5.51555 8.17484 5.6642L9.0457 7.42875C9.07483 7.48778 9.13114 7.52869 9.19629 7.53816L11.1436 7.82112C11.3076 7.84496 11.3731 8.04655 11.2544 8.16226L9.84535 9.53577C9.79821 9.58172 9.7767 9.64792 9.78783 9.7128L10.1205 11.6522C10.1485 11.8156 9.97701 11.9402 9.83028 11.8631L8.08856 10.9474C8.03029 10.9168 7.96069 10.9168 7.90242 10.9474L6.1607 11.8631C6.01398 11.9402 5.84249 11.8156 5.87051 11.6522L6.20315 9.7128C6.21428 9.64792 6.19277 9.58172 6.14563 9.53577L4.73655 8.16226C4.61785 8.04655 4.68335 7.84496 4.84739 7.82112L6.7947 7.53816C6.85984 7.52869 6.91615 7.48778 6.94528 7.42875L7.81614 5.6642Z" fill="url(#paint1_linear_24309_94629)" data-v-6dc27796=""></path></g><defs data-v-6dc27796=""><linearGradient id="paint0_linear_24309_94629" x1="1.75" y1="0.269458" x2="14.2461" y2="13.7306" gradientUnits="userSpaceOnUse" data-v-6dc27796=""><stop stop-color="#FFEFB7" data-v-6dc27796=""></stop><stop offset="0.520833" stop-color="#F3D19B" data-v-6dc27796=""></stop><stop offset="1" stop-color="#FFD89E" data-v-6dc27796=""></stop></linearGradient><linearGradient id="paint1_linear_24309_94629" x1="1.75" y1="0.269458" x2="14.2461" y2="13.7306" gradientUnits="userSpaceOnUse" data-v-6dc27796=""><stop stop-color="#FFEFB7" data-v-6dc27796=""></stop><stop offset="0.520833" stop-color="#F3D19B" data-v-6dc27796=""></stop><stop offset="1" stop-color="#FFD89E" data-v-6dc27796=""></stop></linearGradient><clipPath id="clip0_24309_94629" data-v-6dc27796=""><rect width="16" height="16" fill="white" data-v-6dc27796=""></rect></clipPath></defs></svg> <span class="nav-item-text" data-v-96636f7c="">
          排行榜
          <!----></span></a> <!----></div> <!----></div></nav></div> <nav role="navigation" class="view-nav index-nav-before" data-v-442679f6="" data-v-6dc27796="" data-v-539963b4=""><div class="nav-list left" data-v-442679f6=""><a href="/recommended" class="nav-item" data-v-442679f6=""><div class="category-popover-box" data-v-1bbfa9b8="" data-v-442679f6=""><!----> <span data-v-1bbfa9b8="" data-v-442679f6="" class="">综合</span> <!----></div></a><a href="/backend" class="nav-item" data-v-442679f6=""><div class="category-popover-box" data-v-1bbfa9b8="" data-v-442679f6=""><!----> <span data-v-1bbfa9b8="" data-v-442679f6="" class="">后端</span> <!----></div></a><a href="/hot/articles" target="_blank" class="nav-item" data-v-442679f6=""><div class="category-popover-box" data-v-1bbfa9b8="" data-v-442679f6=""><!----> <span data-v-1bbfa9b8="" data-v-442679f6="" class="">排行榜</span> <!----></div></a><a href="/frontend" class="nav-item" data-v-442679f6=""><div class="category-popover-box" data-v-1bbfa9b8="" data-v-442679f6=""><!----> <span data-v-1bbfa9b8="" data-v-442679f6="" class="">前端</span> <!----></div></a><a href="/android" class="nav-item" data-v-442679f6=""><div class="category-popover-box" data-v-1bbfa9b8="" data-v-442679f6=""><!----> <span data-v-1bbfa9b8="" data-v-442679f6="" class="">Android</span> <!----></div></a><a href="/ios" class="nav-item" data-v-442679f6=""><div class="category-popover-box" data-v-1bbfa9b8="" data-v-442679f6=""><!----> <span data-v-1bbfa9b8="" data-v-442679f6="" class="">iOS</span> <!----></div></a><a href="/ai" aria-current="page" class="nav-item router-link-exact-active route-active active" data-v-442679f6=""><div class="category-popover-box" data-v-1bbfa9b8="" data-v-442679f6=""><!----> <span data-v-1bbfa9b8="" data-v-442679f6="" class="">人工智能</span> <!----></div></a><a href="/freebie" class="nav-item" data-v-442679f6=""><div class="category-popover-box" data-v-1bbfa9b8="" data-v-442679f6=""><!----> <span data-v-1bbfa9b8="" data-v-442679f6="" class="">开发工具</span> <!----></div></a><a href="/career" class="nav-item" data-v-442679f6=""><div class="category-popover-box" data-v-1bbfa9b8="" data-v-442679f6=""><!----> <span data-v-1bbfa9b8="" data-v-442679f6="" class="">代码人生</span> <!----></div></a><a href="/article" class="nav-item" data-v-442679f6=""><div class="category-popover-box" data-v-1bbfa9b8="" data-v-442679f6=""><!----> <span data-v-1bbfa9b8="" data-v-442679f6="" class="">阅读</span> <!----></div></a> <!----></div></nav> <div class="timeline-container" data-v-539963b4="" data-v-6dc27796="">
          <nav role="navigation" class="tag-nav tag-navigator" data-v-1506cd87="" data-v-6dc27796="" data-v-539963b4=""><ul class="nav-list tag-list" data-v-1506cd87=""><li data-v-1506cd87="" class="nav-item tag router-link-exact-active route-active active"><a data-v-1506cd87="" href="/ai" aria-current="page" class="">全部</a></li><li data-v-1506cd87="" class="nav-item tag"><a data-v-1506cd87="" href="/ai/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" class="">人工智能</a></li><li data-v-1506cd87="" class="nav-item tag"><a data-v-1506cd87="" href="/ai/AIGC" class="">AIGC</a></li><li data-v-1506cd87="" class="nav-item tag"><a data-v-1506cd87="" href="/ai/LLM" class="">LLM</a></li><li data-v-1506cd87="" class="nav-item tag"><a data-v-1506cd87="" href="/ai/AI%E7%BC%96%E7%A8%8B" class="">AI编程</a></li><li data-v-1506cd87="" class="nav-item tag"><a data-v-1506cd87="" href="/ai/Agent" class="">Agent</a></li><li data-v-1506cd87="" class="nav-item tag"><a data-v-1506cd87="" href="/ai/OpenAI" class="">OpenAI</a></li><li data-v-1506cd87="" class="nav-item tag"><a data-v-1506cd87="" href="/ai/%E5%90%8E%E7%AB%AF" class="">后端</a></li><li data-v-1506cd87="" class="nav-item tag"><a data-v-1506cd87="" href="/ai/%E7%AE%97%E6%B3%95" class="">算法</a></li><li data-v-1506cd87="" class="nav-item tag"><a data-v-1506cd87="" href="/ai/%E5%89%8D%E7%AB%AF" class="">前端</a></li> <li data-v-1506cd87="" class="nav-item tag unfold">
      展开
    </li></ul></nav><div class="timeline-entry-list" data-v-539963b4="" data-v-6dc27796=""><div class="pc-sub-tags byte-select byte-select--small byte-select--simple" data-v-6dc27796="" data-v-539963b4=""><div class="byte-select__wrap"><div class="byte-select__content-wrap"><!----><!----><input readonly="readonly" value="" class="byte-select__input" style="width:100%;"></div><div class="byte-select__icon-wrap"><!----><span class="byte-select__suffix byte-select__suffix--down"><i class="byte-icon byte-icon--up" style="width:12px;height:12px;"><svg t="1561636079192" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="396971" xmlns:xlink="http://www.w3.org/1999/xlink"><path d="M512 393.6l-346.88 346.88a21.12 21.12 0 0 1-30.08 0l-30.08-30.08a21.12 21.12 0 0 1 0-30.08l376.96-377.6a42.24 42.24 0 0 1 60.16 0l376.96 377.6a21.12 21.12 0 0 1 0 30.08l-30.08 30.08a21.12 21.12 0 0 1-30.08 0z" p-id="396972"></path></svg></i></span></div><span class="byte-select__input" style="height:0;overflow:hidden;position:absolute;max-width:100%;"></span><div class="byte-select-dropdown" style="width: 0px; display: none; position: absolute; max-width: none; will-change: transform; z-index: 1000; top: 0px; left: 0px; transform: translate3d(149px, 27px, 0px);" x-placement="bottom-end"><div class="byte-select-dropdown__wrap" style=""><!----><li data-v-6dc27796="" class="byte-select-option byte-select-option--selected byte-select-option--hover"><a data-v-6dc27796="" href="/ai" aria-current="page" class="sub-tag-link router-link-exact-active route-active">
                全部
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" class="sub-tag-link">
                人工智能
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/LLM" class="sub-tag-link">
                LLM
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/AIGC" class="sub-tag-link">
                AIGC
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/AI%E7%BC%96%E7%A8%8B" class="sub-tag-link">
                AI编程
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/Agent" class="sub-tag-link">
                Agent
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/OpenAI" class="sub-tag-link">
                OpenAI
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E5%90%8E%E7%AB%AF" class="sub-tag-link">
                后端
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E7%AE%97%E6%B3%95" class="sub-tag-link">
                算法
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E5%89%8D%E7%AB%AF" class="sub-tag-link">
                前端
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E7%A8%8B%E5%BA%8F%E5%91%98" class="sub-tag-link">
                程序员
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/Python" class="sub-tag-link">
                Python
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/MCP" class="sub-tag-link">
                MCP
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E6%B7%B1%E5%BA%A6%E5%AD%A6%E4%B9%A0" class="sub-tag-link">
                深度学习
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/Trae" class="sub-tag-link">
                Trae
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E8%AE%A1%E7%AE%97%E6%9C%BA%E8%A7%86%E8%A7%89" class="sub-tag-link">
                计算机视觉
              </a></li></div><!----></div></div></div> <div class="entry-list-container" data-v-ef9a6abe="" data-v-6dc27796="" data-v-539963b4="" style="
    z-index: 10;
"><header class="list-header" style="display:;" data-v-ef9a6abe=""><nav role="navigation" class="list-nav" data-v-ef9a6abe=""><ul class="nav-list left" data-v-ef9a6abe=""><li class="nav-item active" data-v-ef9a6abe=""><a href="/ai" data-v-ef9a6abe="">推荐</a></li><li class="nav-item" data-v-ef9a6abe=""><a href="/ai?sort=newest" data-v-ef9a6abe="">最新</a></li></ul> <div class="dorp-down-area" data-v-ef9a6abe=""><!----></div></nav></header> <div class="entry-list-wrap" data-v-21339fef="" data-v-ef9a6abe=""><div data-v-21339fef="" data-v-435011c0="" data-v-ef9a6abe="" name="entry-list" tag="div" class="entry-list list" ad-list=""><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item"><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7532003590262784039" data-original-type="0" data-draft-id="7531985418654367787" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7532003590262784039" target="_blank" rel="" class="jj-link title" title="Gemini CLI 代码解析">Gemini CLI 代码解析</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7532003590262784039" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">Gemini CLI 代码解析 前言 Gemini CLI 已经开源发布了一段时间了，使用了下感觉功能还是很强大的。代码开源也给了我们一个很好的机会来观摩这样一个功能强大的 agent 到底是怎么工作</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/78820568737607" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                时节
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">213</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              1
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E6%BA%90%E7%A0%81%E9%98%85%E8%AF%BB" target="_blank" rel="" class="jj-link footer-tag footer-tag-only" title="源码阅读">
            源码阅读
          </a></div></div></div> <!----></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item"><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7532021235187466276" data-original-type="0" data-draft-id="7532021235187449892" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7532021235187466276" target="_blank" rel="" class="jj-link title" title="扣子（Coze）实战：化身小红薯旅游博主，一键产出爆款旅游攻略笔记">扣子（Coze）实战：化身小红薯旅游博主，一键产出爆款旅游攻略笔记</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7532021235187466276" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">今天要分享的是一个工作流，工作流接收旅行的目的地和行程，然后工作流开始运作，帮你产出一篇小红薯旅游攻略笔记，并附上旅游景点图片，简直不要太方便了。</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/3683842894347076" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                吾鳴
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">377</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              2
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/Coze" target="_blank" rel="" class="jj-link footer-tag footer-tag-only width-limited" title="Coze">
            Coze
          </a></div></div></div> <img data-v-5244ef91="" data-v-012280ec="" src="https://p9-xtjj-sign.byteimg.com/tos-cn-i-73owjymdk6/f379fcb2f8904f54835a805d80553cd2~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5ZC-6bO0:q75.awebp?rk3s=f64ab15b&amp;x-expires=1761126741&amp;x-signature=1MfOfERoXjKE8RZ0S2n%2FtlzpKnk%3D" alt="扣子（Coze）实战：化身小红薯旅游博主，一键产出爆款旅游攻略笔记" class="lazy thumb" loading="lazy" style=""></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item"><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7517285070797897763" data-original-type="0" data-draft-id="7517179929303744527" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7517285070797897763" target="_blank" rel="" class="jj-link title" title="💡 &ZeroWidthSpace;&ZeroWidthSpace;Transformer数据管道：自定义Dataset类+智能批处理最佳实践&ZeroWidthSpace;">💡 &ZeroWidthSpace;&ZeroWidthSpace;Transformer数据管道：自定义Dataset类+智能批处理最佳实践&ZeroWidthSpace;</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7517285070797897763" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">本文深入解析大模型开发中的数据预处理全流程，掌握这些技能可处理TB级文本数据，构建工业级数据流水线。 一、环境配置与工具选型 工具对比表 二、大规模文本处理实战（100GB+） 1. 高效数据加载</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/127964820815389" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                聚客AI
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">2.5k</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              1
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" target="_blank" rel="" class="jj-link footer-tag width-limited" title="人工智能">
            人工智能
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84" target="_blank" rel="" class="jj-link footer-tag width-limited" title="数据结构">
            数据结构
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/LLM" target="_blank" rel="" class="jj-link footer-tag width-limited" title="LLM">
            LLM
          </a></div></div></div> <img data-v-5244ef91="" data-v-012280ec="" src="https://p9-xtjj-sign.byteimg.com/tos-cn-i-73owjymdk6/b5d2088b2c4b49e294aaca047300a929~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg6IGa5a6iQUk=:q75.awebp?rk3s=f64ab15b&amp;x-expires=1761126741&amp;x-signature=3A2UhyXsuMr1DgUv3%2FfEqR1DSvo%3D" alt="💡 &ZeroWidthSpace;&ZeroWidthSpace;Transformer数据管道：自定义Dataset类+智能批处理最佳实践&ZeroWidthSpace;" class="lazy thumb" loading="lazy" style=""></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item"><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7530437804129828904" data-original-type="0" data-draft-id="7530455852169412642" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7530437804129828904" target="_blank" rel="" class="jj-link title" title="vivo自研蓝河操作系统内核开源！Rust开发新机遇来了">vivo自研蓝河操作系统内核开源！Rust开发新机遇来了</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7530437804129828904" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">芜湖~ 在 AI 重塑智能终端这个关键时刻，首个适用于嵌入式和移动设备的开源 Rust 内核，来了！ vivo 最新宣布，开源自研蓝河操作系统内核。</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/2858385963484488" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                量子位
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">797</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              6
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/Rust" target="_blank" rel="" class="jj-link footer-tag" title="Rust">
            Rust
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/AI%E7%BC%96%E7%A8%8B" target="_blank" rel="" class="jj-link footer-tag" title="AI编程">
            AI编程
          </a></div></div></div> <!----></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item"><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7529453553204461578" data-original-type="0" data-draft-id="7529374107604910116" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7529453553204461578" target="_blank" rel="" class="jj-link title" title="扣子（Coze）基础：扣子入门教程——初识扣子">扣子（Coze）基础：扣子入门教程——初识扣子</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7529453553204461578" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">扣子是什么？扣子能做什么？为什么选择扣子？这是一篇介绍性文章，带你初体会扣子是个什么东东，它能解决我们什么问题，以及为什么要选择使用它，文章里都有答案！</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/3683842894347076" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                吾鳴
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">1.4k</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              2
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/Coze" target="_blank" rel="" class="jj-link footer-tag footer-tag-only width-limited" title="Coze">
            Coze
          </a></div></div></div> <img data-v-5244ef91="" data-v-012280ec="" src="https://p9-xtjj-sign.byteimg.com/tos-cn-i-73owjymdk6/86c461f4882d4306bb0421e8fbadc685~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5ZC-6bO0:q75.awebp?rk3s=f64ab15b&amp;x-expires=1761126741&amp;x-signature=%2B8hG%2B0M93gbl6AYFO5m7A8mDziQ%3D" alt="扣子（Coze）基础：扣子入门教程——初识扣子" class="lazy thumb" loading="lazy" style=""></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item"><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7530091637373665280" data-original-type="0" data-draft-id="7530085628067758080" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7530091637373665280" target="_blank" rel="" class="jj-link title" title="关于智能体（AI Agent），不得不看的一篇总结（建议收藏）">关于智能体（AI Agent），不得不看的一篇总结（建议收藏）</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7530091637373665280" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">AI技术的发展可谓是日新月异，尤其是AI智能体这个领域，真是让人眼花缭乱。不知道你是否和我一样，经常被各种AI智能体、AI助手、AI代理这些概念搞得有点头晕目眩？</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/3817967696221534" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                AI大模型
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">418</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              4
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/Agent" target="_blank" rel="" class="jj-link footer-tag" title="Agent">
            Agent
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/LLM" target="_blank" rel="" class="jj-link footer-tag" title="LLM">
            LLM
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E7%A8%8B%E5%BA%8F%E5%91%98" target="_blank" rel="" class="jj-link footer-tag" title="程序员">
            程序员
          </a></div></div></div> <!----></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item"><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7538282563040526363" data-original-type="0" data-draft-id="7537982057199108147" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7538282563040526363" target="_blank" rel="" class="jj-link title" title="GPT-5发布引发用户强烈反弹，OpenAI紧急回应">GPT-5发布引发用户强烈反弹，OpenAI紧急回应</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7538282563040526363" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">OpenAI在8月7日发布GPT-5后，意外遭遇了大规模用户抗议。许多长期用户表示，新模型虽然在技术指标上有所提升，但却失去了GPT-4o的"灵魂"。 正如推文中Kona'Bird所说："失去GPT-</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/581021766790141" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                哪吒编程
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">334</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              点赞
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/OpenAI" target="_blank" rel="" class="jj-link footer-tag width-limited" title="OpenAI">
            OpenAI
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/ChatGPT" target="_blank" rel="" class="jj-link footer-tag width-limited" title="ChatGPT">
            ChatGPT
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/GPT" target="_blank" rel="" class="jj-link footer-tag width-limited" title="GPT">
            GPT
          </a></div></div></div> <img data-v-5244ef91="" data-v-012280ec="" src="https://p9-xtjj-sign.byteimg.com/tos-cn-i-73owjymdk6/b6d37b22823c456f93dd12ba9821f7fd~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5ZOq5ZCS57yW56iL:q75.awebp?rk3s=f64ab15b&amp;x-expires=1761126741&amp;x-signature=aDHMpc50F8HXUWu3c56n%2Fj%2BktGQ%3D" alt="GPT-5发布引发用户强烈反弹，OpenAI紧急回应" class="lazy thumb" loading="lazy" style=""></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item"><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7559431431991951400" data-original-type="0" data-draft-id="7559286535990296576" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7559431431991951400" target="_blank" rel="" class="jj-link title" title="使用eBPF技术保护FastAPI安全">使用eBPF技术保护FastAPI安全</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7559431431991951400" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">本文详细介绍如何利用eBPF技术保护面向互联网的API安全，包括FastAPI、Flask、Django等框架。通过secimport工具实现Python代码的实时追踪、沙箱策略构建和运行时监控，有效</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/1743174852185579" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                qife122
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">19</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              点赞
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" target="_blank" rel="" class="jj-link footer-tag" title="人工智能">
            人工智能
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/AIGC" target="_blank" rel="" class="jj-link footer-tag" title="AIGC">
            AIGC
          </a></div></div></div> <!----></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item"><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7559412836339990582" data-original-type="0" data-draft-id="7559435122450497590" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7559412836339990582" target="_blank" rel="" class="jj-link title" title="一篇搞懂：飞书多维表格、n8n、Dify 等自动化工作流里的 Webhook 到底是个啥">一篇搞懂：飞书多维表格、n8n、Dify 等自动化工作流里的 Webhook 到底是个啥</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7559412836339990582" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">还在为飞书、n8n 里的 Webhook 犯愁？本文用“系统门铃”大白话讲透原理，带你躲开安全、重复等三大实战“深坑”。</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/3291311939012891" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                万涂幻象
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">65</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              点赞
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" target="_blank" rel="" class="jj-link footer-tag footer-tag-only width-limited" title="人工智能">
            人工智能
          </a></div></div></div> <img data-v-5244ef91="" data-v-012280ec="" src="https://p9-xtjj-sign.byteimg.com/tos-cn-i-73owjymdk6/f32dfab4774b4c019cfedaec67ab0572~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5LiH5raC5bm76LGh:q75.awebp?rk3s=f64ab15b&amp;x-expires=1761126741&amp;x-signature=PJ2J4L2eS3c5uNqYiC4sR32PvEA%3D" alt="一篇搞懂：飞书多维表格、n8n、Dify 等自动化工作流里的 Webhook 到底是个啥" class="lazy thumb" loading="lazy" style=""></div> <!----></div> <div data-v-02fb02b6="" data-v-435011c0="" class="juejin-ab-test-wrap"><div data-v-02fb02b6="" class="item-login-wrap"><div data-v-02fb02b6="" class="item-login-button">登录 / 注册</div> <div data-v-02fb02b6="" class="item-login-text">可定制个人专属的推荐内容列表</div></div></div> <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7546326670677229594" data-original-type="0" data-draft-id="7546179070925537290" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7546326670677229594" target="_blank" rel="" class="jj-link title" title="👀10分钟搞懂RAG架构：离线索引+在线检索的闭环秘密">👀10分钟搞懂RAG架构：离线索引+在线检索的闭环秘密</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7546326670677229594" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">RAG的检索增强生成（Retrieval-Augmented Generation, RAG）技术，一直是不少人研究和优化的方向，RAG通过整合外部知识库来增强模型能力，特别适用于实时性、准确性和专业</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/127964820815389" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                聚客AI
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">2.6k</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              6
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" target="_blank" rel="" class="jj-link footer-tag width-limited" title="人工智能">
            人工智能
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/LLM" target="_blank" rel="" class="jj-link footer-tag width-limited" title="LLM">
            LLM
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/Agent" target="_blank" rel="" class="jj-link footer-tag width-limited" title="Agent">
            Agent
          </a></div></div></div> <img data-v-5244ef91="" data-v-012280ec="" src="https://p9-xtjj-sign.byteimg.com/tos-cn-i-73owjymdk6/ad1f48da8728489cac77e039e64cddd5~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg6IGa5a6iQUk=:q75.awebp?rk3s=f64ab15b&amp;x-expires=1761126741&amp;x-signature=qJJDPTXuL9uatASML3Hpy%2FABVcI%3D" alt="👀10分钟搞懂RAG架构：离线索引+在线检索的闭环秘密" class="lazy thumb" loading="lazy" style=""></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7559205383504789543" data-original-type="0" data-draft-id="7559236732361932854" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7559205383504789543" target="_blank" rel="" class="jj-link title" title="7种大模型微调的方法全解，看这篇文章就够了！">7种大模型微调的方法全解，看这篇文章就够了！</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7559205383504789543" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">一、大型模型微调的基础理论 大型语言模型(LLM)的训练过程通常分为两大阶段： 阶段一：预训练阶段 在这个阶段，大型模型会在大规模的无标签数据集上接受训练，目标是使模型掌握语言的统计特征和基础知识。 </div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/3572727470361578" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                智泊AI
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">110</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              点赞
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/LLM" target="_blank" rel="" class="jj-link footer-tag footer-tag-only" title="LLM">
            LLM
          </a></div></div></div> <!----></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7536069330304991267" data-original-type="0" data-draft-id="7536070570967187491" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7536069330304991267" target="_blank" rel="" class="jj-link title" title="📰多智能体才是未来：深度解析多Agent架构带你从零到生产级部署">📰多智能体才是未来：深度解析多Agent架构带你从零到生产级部署</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7536069330304991267" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">前言：“ISC.AI 2025互联网安全大会开幕式及未来峰会”于8月6日在北京举行。360集团创始人、ISC大会主席周鸿祎在演讲中表示，行业里还有很多的争论，到底是做单智能体还是多智能体。多智能体这个</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/127964820815389" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                聚客AI
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">1.4k</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              1
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" target="_blank" rel="" class="jj-link footer-tag width-limited" title="人工智能">
            人工智能
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/Agent" target="_blank" rel="" class="jj-link footer-tag width-limited" title="Agent">
            Agent
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/LLM" target="_blank" rel="" class="jj-link footer-tag width-limited" title="LLM">
            LLM
          </a></div></div></div> <img data-v-5244ef91="" data-v-012280ec="" src="https://p9-xtjj-sign.byteimg.com/tos-cn-i-73owjymdk6/2f4b33d752a94603b90e1a9cc389b157~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg6IGa5a6iQUk=:q75.awebp?rk3s=f64ab15b&amp;x-expires=1761126741&amp;x-signature=7hP%2FGHO%2BkC4T5rXcGjuammLyfT0%3D" alt="📰多智能体才是未来：深度解析多Agent架构带你从零到生产级部署" class="lazy thumb" loading="lazy" style=""></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7533171294175805466" data-original-type="0" data-draft-id="7533150906671218738" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7533171294175805466" target="_blank" rel="" class="jj-link title" title=" Claude code 用不起，为什么不试试接入智谱 GLM-4.5呢"> Claude code 用不起，为什么不试试接入智谱 GLM-4.5呢</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7533171294175805466" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">最近，终端 AI编程工具的风潮可谓是刮遍了全网！相信你也刷到过不少让人心痒痒的视频，比如“深度使用Claude Code一个月后，我决定退订Cursor”之类的。 这些内容让人不禁要问：Claude </div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/2963939080017448" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                biubiubiu王大锤
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">824</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              3
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" target="_blank" rel="" class="jj-link footer-tag footer-tag-only width-limited" title="人工智能">
            人工智能
          </a></div></div></div> <img data-v-5244ef91="" data-v-012280ec="" src="https://p9-xtjj-sign.byteimg.com/tos-cn-i-73owjymdk6/9056b3d8935e4014a8369d1dfd951084~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgYml1Yml1Yml1546L5aSn6ZSk:q75.awebp?rk3s=f64ab15b&amp;x-expires=1761126741&amp;x-signature=dRPVDn6LxiXqPtbU%2FX5xrPyfvHk%3D" alt=" Claude code 用不起，为什么不试试接入智谱 GLM-4.5呢" class="lazy thumb" loading="lazy" style=""></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7559412836339679286" data-original-type="0" data-draft-id="7559103707759509547" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7559412836339679286" target="_blank" rel="" class="jj-link title" title="低代码Agent开发框架使用指南（二）—Coze平台核心功能概览">低代码Agent开发框架使用指南（二）—Coze平台核心功能概览</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7559412836339679286" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">Coze以免费易用、多模型支持和跨平台发布为核心优势，降低了智能体开发门槛。文章解析了Coze的六大核心功能：插件系统、知识库、数据库、图像流、工作流，以及多智能体，全面展现了Coze平台的强大能力。</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/3140624091453053" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                大模型真好玩
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">176</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              2
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" target="_blank" rel="" class="jj-link footer-tag width-limited" title="人工智能">
            人工智能
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/Coze" target="_blank" rel="" class="jj-link footer-tag width-limited" title="Coze">
            Coze
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/DeepSeek" target="_blank" rel="" class="jj-link footer-tag width-limited" title="DeepSeek">
            DeepSeek
          </a></div></div></div> <img data-v-5244ef91="" data-v-012280ec="" src="https://p9-xtjj-sign.byteimg.com/tos-cn-i-73owjymdk6/c850176cb7a040649aff1baebd55a9e7~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5aSn5qih5Z6L55yf5aW9546p:q75.awebp?rk3s=f64ab15b&amp;x-expires=1761126741&amp;x-signature=VTLC7MJmgvibbMh3U%2B4gTzE4MGQ%3D" alt="低代码Agent开发框架使用指南（二）—Coze平台核心功能概览" class="lazy thumb" loading="lazy" style=""></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7555672282555809826" data-original-type="0" data-draft-id="7555450596671275023" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7555672282555809826" target="_blank" rel="" class="jj-link title" title="宇树机器人被曝漏洞，机器人之间可相互感染，官方火速回应">宇树机器人被曝漏洞，机器人之间可相互感染，官方火速回应</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7555672282555809826" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">宇树旗下多款机器人，被曝存在严重的无线安全漏洞！ 消息由 IEEE Spectrum 报道指出。</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/2858385963484488" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                量子位
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">639</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              1
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" target="_blank" rel="" class="jj-link footer-tag" title="人工智能">
            人工智能
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/AI%E7%BC%96%E7%A8%8B" target="_blank" rel="" class="jj-link footer-tag" title="AI编程">
            AI编程
          </a></div></div></div> <!----></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7548835244297994250" data-original-type="0" data-draft-id="7548649287799816202" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7548835244297994250" target="_blank" rel="" class="jj-link title" title="和文心快码做朋友，让编程像“说话”一样简单">和文心快码做朋友，让编程像“说话”一样简单</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7548835244297994250" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">你是否曾经觉得编程是一件非常神秘、高深莫测的事情？看到程序员在键盘上敲出一行行看似天书的代码，心里既羡慕又有点畏惧？如果我告诉你，现在有一种工具，可以让编程变得像“说话”一样简单，甚至一个小白都能快速</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/1574156383557255" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                法医
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">1.7k</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              3
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E5%89%8D%E7%AB%AF" target="_blank" rel="" class="jj-link footer-tag" title="前端">
            前端
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E6%96%87%E5%BF%83%E5%BF%AB%E7%A0%81" target="_blank" rel="" class="jj-link footer-tag" title="文心快码">
            文心快码
          </a></div></div></div> <!----></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7559524490637344808" data-original-type="0" data-draft-id="7559590686833442850" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7559524490637344808" target="_blank" rel="" class="jj-link title" title=" n8n vs Dify，看看它们各自的定位、优势、适用场景、限制"> n8n vs Dify，看看它们各自的定位、优势、适用场景、限制</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7559524490637344808" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">概况对比 特性 n8n Dify 核心定位 通用的工作流 / 自动化工具，用于连接多个系统、触发器、API、数据流等。&nbsp; 面向 LLM / 生成式 AI 应用的低代码 / 平台工具，支持 agent、</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/4019470240065454" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                码农小懒哥
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">101</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              点赞
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/OpenAI" target="_blank" rel="" class="jj-link footer-tag" title="OpenAI">
            OpenAI
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/AIGC" target="_blank" rel="" class="jj-link footer-tag" title="AIGC">
            AIGC
          </a></div></div></div> <!----></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7537908362806411314" data-original-type="0" data-draft-id="7537913159111311410" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7537908362806411314" target="_blank" rel="" class="jj-link title" title="字节Trae2.0上线 SOLO 模式，让AI像程序员一样编程">字节Trae2.0上线 SOLO 模式，让AI像程序员一样编程</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7537908362806411314" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">字节最早发布的AI编程工具叫MarsCode，分为MarsCode插件和网页版本的MarsCode IDE。后面统一成了Trae，Trae也为国内版本Trae CN与国际版本Trae COM。 我们先</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/2225067268010136" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                栈江湖
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">288</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              点赞
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/Trae" target="_blank" rel="" class="jj-link footer-tag footer-tag-only width-limited" title="Trae">
            Trae
          </a></div></div></div> <img data-v-5244ef91="" data-v-012280ec="" src="https://p9-xtjj-sign.byteimg.com/tos-cn-i-73owjymdk6/9f5f764be840478d8ba3ce2a3f28a4a0~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5qCI5rGf5rmW:q75.awebp?rk3s=f64ab15b&amp;x-expires=1761126741&amp;x-signature=66wftVjnkKdYu37Eqv1tDD23nks%3D" alt="字节Trae2.0上线 SOLO 模式，让AI像程序员一样编程" class="lazy thumb" loading="lazy" style=""></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7554687466503323648" data-original-type="0" data-draft-id="7554687466503307264" class="entry" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7554687466503323648" target="_blank" rel="" class="jj-link title" title="我们是否需要AI知识库">我们是否需要AI知识库</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7554687466503323648" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">前几天听到一个朋友说，搞一个自己的知识库比旧式的看文写博客记笔记更优越，以前的方式out了，几千字的文章，几小时的视频资料，直接喂给AI，省去自己阅读和观看的时间，需要的时候直接跟AI对话……</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/2066737589913117" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                Canace
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">218</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              点赞
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" target="_blank" rel="" class="jj-link footer-tag" title="人工智能">
            人工智能
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/AI%E7%BC%96%E7%A8%8B" target="_blank" rel="" class="jj-link footer-tag" title="AI编程">
            AI编程
          </a><a data-v-65b50b51="" data-v-012280ec="" href="/tag/AIGC" target="_blank" rel="" class="jj-link footer-tag" title="AIGC">
            AIGC
          </a></div></div></div> <!----></div> <!----></div>  <!----></li><li data-v-435011c0="" data-growing-container="true" data-growing-title="entryList" class="item" style=""><div data-v-012280ec="" data-v-435011c0="" data-entry-id="7559519764118716466" data-original-type="0" data-draft-id="7559510418130894890" class="entry entry-last-one" enter-method="item_display_feed"><div data-v-012280ec="" class="content-wrapper"><div data-v-012280ec="" class="content-main"><div data-v-012280ec="" class="title-row"> <!----> <!----> <!----> <a data-v-65b50b51="" data-v-012280ec="" href="/post/7559519764118716466" target="_blank" rel="" class="jj-link title" title="企业微信iPad协议演进：从私有二进制到可扩展接口">企业微信iPad协议演进：从私有二进制到可扩展接口</a></div> <div data-v-012280ec="" class="abstract"><a data-v-65b50b51="" data-v-012280ec="" href="/post/7559519764118716466" target="_blank" rel="" class="jj-link"><div data-v-012280ec="" data-v-65b50b51="">企业微信在移动端的早期实现，曾采用封闭的二进制协议，iPad 端亦不例外。该协议以 TLV（Type-Length-Value）为核心，通过 0x01~0xFF 的指令空间完成登录、消息同步与文件传输</div></a></div> <div data-v-012280ec="" class="entry-footer"><ul data-v-012280ec="" class="action-list jh-timeline-action-area"><li data-v-012280ec="" class="item meta-container"><a data-v-65b50b51="" data-v-012280ec="" href="/user/1092275002677466" target="_blank" rel="" class="jj-link user-message"><div data-v-487cbd49="" data-v-889b6f90="" data-v-012280ec="" class="popover-box user-popover" data-v-65b50b51=""><!---->  
                bot555666
              </div></a> <div data-v-012280ec="" class="footer-divider"></div></li> <!----> <li data-v-012280ec="" class="item view"><svg data-v-012280ec="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="view-icon"><path data-v-012280ec="" d="M7.90078 2.80078C4.49278 2.80078 1.74745 6.11672 0.800781 7.77469C1.74745 9.58339 4.49278 13.2008 7.90078 13.2008C11.3088 13.2008 14.0541 9.58339 15.0008 7.77469C14.0541 6.11672 11.3088 2.80078 7.90078 2.80078Z" stroke="currentColor"></path><circle data-v-012280ec="" cx="7.89922" cy="8.00078" r="2.2" stroke="currentColor"></circle></svg> <span data-v-012280ec="">32</span></li> <li data-v-012280ec="" class="item like"><div data-v-012280ec="" class="liked-wrap"><svg data-v-012280ec="" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="liked-icon"><path data-v-012280ec="" fill-rule="evenodd" clip-rule="evenodd" d="M7.56162 1.16952C7.66569 1.09661 7.78195 1.06124 7.88247 1.0912C7.97653 1.11923 8.23851 1.25916 8.50988 1.96799C8.64419 2.31881 8.9356 3.2424 8.42155 5.05431C8.29751 5.49152 8.61394 5.95303 9.09259 5.95971L12.492 6.00716L12.492 6.00721H12.4991C12.6049 6.00721 12.7228 6.01986 12.8134 6.05898C12.8544 6.07671 12.8815 6.09639 12.8999 6.116C12.9166 6.13375 12.9368 6.16247 12.9515 6.21636C12.9848 6.33784 13.0228 6.74712 12.9473 7.42262C12.874 8.07857 12.698 8.94479 12.341 9.9598C12.0424 10.8088 11.6601 11.5292 11.0684 12.4879C11.0558 12.5052 11.0462 12.5197 11.0418 12.5265L11.0404 12.5285C11.0292 12.5454 11.0242 12.5531 11.018 12.5618C11.0076 12.5764 11.0018 12.582 10.9983 12.585C10.996 12.587 10.9908 12.5912 10.9777 12.5959C10.9638 12.6009 10.9311 12.61 10.8706 12.61H4.56278L4.56373 5.58489C4.87126 5.41901 5.19881 5.20128 5.54112 4.84059C5.93883 4.42152 6.33789 3.8294 6.76254 2.94183C6.84974 2.75957 6.91745 2.55962 6.97574 2.37762C6.99264 2.32486 7.0087 2.27379 7.02438 2.22393L7.02439 2.22389C7.066 2.09158 7.10495 1.96776 7.14985 1.84312C7.2758 1.49352 7.40247 1.28101 7.56162 1.16952ZM9.45205 1.60729C9.13229 0.772086 8.70208 0.282772 8.17063 0.124374C7.64564 -0.0320981 7.20308 0.188912 6.98278 0.343248C6.55169 0.64525 6.33837 1.11908 6.20071 1.5012C6.14817 1.64705 6.10002 1.80016 6.05661 1.93824C6.0422 1.98405 6.02832 2.02821 6.01496 2.0699C5.95791 2.24804 5.90763 2.39115 5.85248 2.50643C5.45683 3.3334 5.1121 3.8271 4.80935 4.14611C4.51322 4.45815 4.23983 4.6219 3.9473 4.76821C3.71095 4.88641 3.55494 5.12906 3.55491 5.40159L3.55388 12.9125C3.55383 13.3026 3.87002 13.6188 4.26008 13.6188H10.8706C11.2097 13.6188 11.4663 13.5113 11.6519 13.3535C11.7387 13.2797 11.7988 13.2043 11.8387 13.1484C11.8556 13.1248 11.8704 13.1025 11.8786 13.09L11.8813 13.0859L11.8826 13.0839L11.8955 13.0685L11.9142 13.0382C12.5304 12.0414 12.9578 11.247 13.2927 10.2945C13.6745 9.20895 13.8679 8.26811 13.9499 7.5347C14.0297 6.82084 14.009 6.25845 13.9246 5.95014C13.805 5.51285 13.5104 5.26112 13.2134 5.13284C12.9385 5.01407 12.661 4.99859 12.5028 4.99836L9.49071 4.95631C9.92962 3.15791 9.64796 2.11902 9.45205 1.60729ZM0.000800636 5.46783C-0.0181914 5.0652 0.303128 4.72836 0.706212 4.72836H1.75264C2.14266 4.72836 2.45883 5.04454 2.45883 5.43456V12.9442C2.45883 13.3342 2.14266 13.6504 1.75264 13.6504H1.06044C0.68335 13.6504 0.372791 13.3541 0.355024 12.9775L0.000800636 5.46783Z" fill="currentColor"></path></svg></div> <span data-v-012280ec="">
              点赞
            </span></li> <!----> <li data-v-012280ec="" class="item dislike-item"><div data-v-30fd6c37="" data-v-012280ec="" class="dislike-button"><span data-v-30fd6c37="" class="icon-close"><svg data-v-30fd6c37="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-30fd6c37="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-30fd6c37="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></span> <!----></div></li> <!----></ul> <div data-v-012280ec="" class="entry-footer-tags"><a data-v-65b50b51="" data-v-012280ec="" href="/tag/%E9%9D%A2%E8%AF%95" target="_blank" rel="" class="jj-link footer-tag footer-tag-only" title="面试">
            面试
          </a></div></div></div> <!----></div> <!----></div>  <!----></li></div></div> <!----> <!----></div></div> <div class="timeline-content" data-v-539963b4="" data-v-6dc27796="">
    <div class="timeline-entry-list" data-v-539963b4="" data-v-6dc27796=""><div class="pc-sub-tags byte-select byte-select--small byte-select--simple" data-v-6dc27796="" data-v-539963b4=""><div class="byte-select__wrap"><div class="byte-select__content-wrap"><!----><!----><input value="" class="byte-select__input" style="width:100%;" __h2d_shadowroot="534" readonly="readonly"></div><div class="byte-select__icon-wrap"><!----><span class="byte-select__suffix byte-select__suffix--down"><i class="byte-icon byte-icon--up" style="width:12px;height:12px;"><svg t="1561636079192" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="396971" xmlns:xlink="http://www.w3.org/1999/xlink"><path d="M512 393.6l-346.88 346.88a21.12 21.12 0 0 1-30.08 0l-30.08-30.08a21.12 21.12 0 0 1 0-30.08l376.96-377.6a42.24 42.24 0 0 1 60.16 0l376.96 377.6a21.12 21.12 0 0 1 0 30.08l-30.08 30.08a21.12 21.12 0 0 1-30.08 0z" p-id="396972"></path></svg></i></span></div><span class="byte-select__input" style="height:0;overflow:hidden;position:absolute;max-width:100%;"></span><div class="byte-select-dropdown" style="width: 152px; max-width: none; z-index: 1015; display: none; position: absolute; will-change: transform; top: 0px; left: 0px; transform: translate3d(0px, 5px, 0px);" x-placement="bottom-end" x-out-of-boundaries=""><div class="byte-select-dropdown__wrap" style=""><!----><li data-v-6dc27796="" class="byte-select-option byte-select-option--selected byte-select-option--hover"><a data-v-6dc27796="" href="/ai" aria-current="page" class="sub-tag-link router-link-exact-active route-active">
                全部
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD" class="sub-tag-link">
                人工智能
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/AIGC" class="sub-tag-link">
                AIGC
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/LLM" class="sub-tag-link">
                LLM
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/AI%E7%BC%96%E7%A8%8B" class="sub-tag-link">
                AI编程
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/Agent" class="sub-tag-link">
                Agent
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/OpenAI" class="sub-tag-link">
                OpenAI
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E5%90%8E%E7%AB%AF" class="sub-tag-link">
                后端
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E7%AE%97%E6%B3%95" class="sub-tag-link">
                算法
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E5%89%8D%E7%AB%AF" class="sub-tag-link">
                前端
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/Python" class="sub-tag-link">
                Python
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E7%A8%8B%E5%BA%8F%E5%91%98" class="sub-tag-link">
                程序员
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/Trae" class="sub-tag-link">
                Trae
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/MCP" class="sub-tag-link">
                MCP
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E6%B7%B1%E5%BA%A6%E5%AD%A6%E4%B9%A0" class="sub-tag-link">
                深度学习
              </a></li><li data-v-6dc27796="" class="byte-select-option"><a data-v-6dc27796="" href="/ai/%E8%AE%A1%E7%AE%97%E6%9C%BA%E8%A7%86%E8%A7%89" class="sub-tag-link">
                计算机视觉
              </a></li></div><!----></div></div></div> </div> <aside class="index-aside aside" data-v-4e378738="" data-v-6dc27796="" data-v-539963b4=""> <div id="wechat-assets__home-top-right" data-v-4e378738="" class=""></div> <div data-v-f33c35a0="" data-v-4e378738="" class="hot-list-container"><div data-v-f33c35a0="" class="hot-list-item"><div data-v-f33c35a0="" class="hot-item-header"><div data-v-f33c35a0="" class="hot-title"><img data-v-f33c35a0="" src="https://p9-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/65d192768e254a768c4391e2b92a4bb6~tplv-k3u1fbpfcp-watermark.image?" type="icon" alt="icon" class="hot-icon"> <span data-v-f33c35a0="" title="文章榜" class="title-text">
          文章榜
        </span></div> <div data-v-f33c35a0="" class="item-header-button"><svg data-v-f33c35a0="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><path data-v-f33c35a0="" fill-rule="evenodd" clip-rule="evenodd" d="M9.66667 6.66667C9.48257 6.66667 9.33333 6.51743 9.33333 6.33333V5.66667C9.33333 5.48257 9.48257 5.33333 9.66667 5.33333L11.8303 5.3334C10.987 4.12437 9.58586 3.33333 8 3.33333C5.42267 3.33333 3.33333 5.42267 3.33333 8C3.33333 10.5773 5.42267 12.6667 8 12.6667C10.1139 12.6667 11.8996 11.2611 12.4733 9.33358L13.8513 9.33355C13.2449 12.0054 10.8554 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C9.88507 2 11.5671 2.86932 12.6671 4.22893L12.6667 2.33333C12.6667 2.14924 12.8159 2 13 2H13.6667C13.8508 2 14 2.14924 14 2.33333V6C14 6.35145 13.728 6.63939 13.3831 6.66484L13.3333 6.66667H9.66667Z" fill="#8A919F"></path></svg> <span data-v-f33c35a0="" class="text">换一换</span></div></div> <div data-v-f33c35a0="" class="divider" style="margin-bottom: 4px;"><div data-v-f33c35a0="" class="content"></div></div> <ul data-v-f33c35a0="" class="hot-item-body"><div data-v-21339fef="" data-v-f33c35a0="" class="skeleton"><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-article"><div data-v-f33c35a0="" data-v-21339fef="" class="body-index first-index">
            1
          </div> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-article"><a data-v-f33c35a0="" href="/post/7558094123812552745" class="title-articles" target="_blank" title="AI 写代码总跑偏？试试费曼学习法：让它先复述一遍！" data-v-21339fef="">
              AI 写代码总跑偏？试试费曼学习法：让它先复述一遍！
            </a> <a data-v-f33c35a0="" href="/post/7558094123812552745" class="info" target="_blank" title="AI 写代码总跑偏？试试费曼学习法：让它先复述一遍！" data-v-21339fef=""></a> <!----></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-article"><div data-v-f33c35a0="" data-v-21339fef="" class="body-index second-index">
            2
          </div> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-article"><a data-v-f33c35a0="" href="/post/7558468868600283186" class="title-articles" target="_blank" title="忍了一年多，我做了一个工具将文章一键发布到多个平台" data-v-21339fef="">
              忍了一年多，我做了一个工具将文章一键发布到多个平台
            </a> <a data-v-f33c35a0="" href="/post/7558468868600283186" class="info" target="_blank" title="忍了一年多，我做了一个工具将文章一键发布到多个平台" data-v-21339fef=""></a> <!----></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-article"><div data-v-f33c35a0="" data-v-21339fef="" class="body-index third-index">
            3
          </div> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-article"><a data-v-f33c35a0="" href="/post/7557921840553164841" class="title-articles" target="_blank" title="程序员福利！GitHub最火的Spec Kit项目深度解析：只需7条命令就能实现规格驱动开发，告别繁琐的PRD文档，让规范直接生成代码！支持Claude Cod" data-v-21339fef="">
              程序员福利！GitHub最火的Spec Kit项目深度解析：只需7条命令就能实现规格驱动开发，告别繁琐的PRD文档，让规范直接生成代码！支持Claude Cod
            </a> <a data-v-f33c35a0="" href="/post/7557921840553164841" class="info" target="_blank" title="程序员福利！GitHub最火的Spec Kit项目深度解析：只需7条命令就能实现规格驱动开发，告别繁琐的PRD文档，让规范直接生成代码！支持Claude Cod" data-v-21339fef=""></a> <!----></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-article"><div data-v-f33c35a0="" data-v-21339fef="" class="body-index">
            4
          </div> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-article"><a data-v-f33c35a0="" href="/post/7558616190953127977" class="title-articles" target="_blank" title="AI 时代，每个程序员都该拥有个人提示词库：从效率工具到战略资产的蜕变" data-v-21339fef="">
              AI 时代，每个程序员都该拥有个人提示词库：从效率工具到战略资产的蜕变
            </a> <a data-v-f33c35a0="" href="/post/7558616190953127977" class="info" target="_blank" title="AI 时代，每个程序员都该拥有个人提示词库：从效率工具到战略资产的蜕变" data-v-21339fef=""></a> <!----></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-article"><div data-v-f33c35a0="" data-v-21339fef="" class="body-index">
            5
          </div> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-article"><a data-v-f33c35a0="" href="/post/7559009457171857450" class="title-articles" target="_blank" title="Claude Code Review：让AI审核更懂你的代码" data-v-21339fef="">
              Claude Code Review：让AI审核更懂你的代码
            </a> <a data-v-f33c35a0="" href="/post/7559009457171857450" class="info" target="_blank" title="Claude Code Review：让AI审核更懂你的代码" data-v-21339fef=""></a> <!----></div></li></div></ul> <div data-v-f33c35a0="" class="divider" style="margin-top: 4px;"><div data-v-f33c35a0="" class="content"></div></div> <div data-v-f33c35a0="" class="hot-item-footer"><a data-v-f33c35a0="" href="/hot/articles/6809637773935378440" class="item-footer-button" target="_blank"><span data-v-f33c35a0="" class="">查看更多</span> <svg data-v-f33c35a0="" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><path data-v-f33c35a0="" d="M6.6094 4.99959L3.22118 1.61137C3.13982 1.53001 3.13982 1.3981 3.22118 1.31674L3.5158 1.02212C3.59716 0.940757 3.72907 0.940757 3.81043 1.02212L7.49328 4.70496C7.656 4.86768 7.656 5.1315 7.49328 5.29422L3.81043 8.97707C3.72907 9.05843 3.59716 9.05843 3.5158 8.97707L3.22118 8.68244C3.13982 8.60108 3.13982 8.46917 3.22118 8.38781L6.6094 4.99959Z"></path></svg></a></div></div></div>  <div class="sidebar-block sticky-block" data-v-4e378738=""><div data-v-f33c35a0="" data-v-4e378738="" class="hot-list-container"><div data-v-f33c35a0="" class="hot-list-item"><div data-v-f33c35a0="" class="hot-item-header"><div data-v-f33c35a0="" class="hot-title"><img data-v-f33c35a0="" src="https://p9-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/65d192768e254a768c4391e2b92a4bb6~tplv-k3u1fbpfcp-watermark.image?" type="icon" alt="icon" class="hot-icon"> <span data-v-f33c35a0="" title="文章榜" class="title-text">
          文章榜
        </span></div> <div data-v-f33c35a0="" class="item-header-button"><svg data-v-f33c35a0="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><path data-v-f33c35a0="" fill-rule="evenodd" clip-rule="evenodd" d="M9.66667 6.66667C9.48257 6.66667 9.33333 6.51743 9.33333 6.33333V5.66667C9.33333 5.48257 9.48257 5.33333 9.66667 5.33333L11.8303 5.3334C10.987 4.12437 9.58586 3.33333 8 3.33333C5.42267 3.33333 3.33333 5.42267 3.33333 8C3.33333 10.5773 5.42267 12.6667 8 12.6667C10.1139 12.6667 11.8996 11.2611 12.4733 9.33358L13.8513 9.33355C13.2449 12.0054 10.8554 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C9.88507 2 11.5671 2.86932 12.6671 4.22893L12.6667 2.33333C12.6667 2.14924 12.8159 2 13 2H13.6667C13.8508 2 14 2.14924 14 2.33333V6C14 6.35145 13.728 6.63939 13.3831 6.66484L13.3333 6.66667H9.66667Z" fill="#8A919F"></path></svg> <span data-v-f33c35a0="" class="text">换一换</span></div></div> <div data-v-f33c35a0="" class="divider" style="margin-bottom: 4px;"><div data-v-f33c35a0="" class="content"></div></div> <ul data-v-f33c35a0="" class="hot-item-body"><div data-v-21339fef="" data-v-f33c35a0="" class="skeleton"><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-article"><div data-v-f33c35a0="" data-v-21339fef="" class="body-index first-index">
            1
          </div> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-article"><a data-v-f33c35a0="" href="/post/7558094123812552745" class="title-articles" target="_blank" title="AI 写代码总跑偏？试试费曼学习法：让它先复述一遍！" data-v-21339fef="">
              AI 写代码总跑偏？试试费曼学习法：让它先复述一遍！
            </a> <a data-v-f33c35a0="" href="/post/7558094123812552745" class="info" target="_blank" title="AI 写代码总跑偏？试试费曼学习法：让它先复述一遍！" data-v-21339fef=""></a> <!----></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-article"><div data-v-f33c35a0="" data-v-21339fef="" class="body-index second-index">
            2
          </div> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-article"><a data-v-f33c35a0="" href="/post/7558468868600283186" class="title-articles" target="_blank" title="忍了一年多，我做了一个工具将文章一键发布到多个平台" data-v-21339fef="">
              忍了一年多，我做了一个工具将文章一键发布到多个平台
            </a> <a data-v-f33c35a0="" href="/post/7558468868600283186" class="info" target="_blank" title="忍了一年多，我做了一个工具将文章一键发布到多个平台" data-v-21339fef=""></a> <!----></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-article"><div data-v-f33c35a0="" data-v-21339fef="" class="body-index third-index">
            3
          </div> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-article"><a data-v-f33c35a0="" href="/post/7557921840553164841" class="title-articles" target="_blank" title="程序员福利！GitHub最火的Spec Kit项目深度解析：只需7条命令就能实现规格驱动开发，告别繁琐的PRD文档，让规范直接生成代码！支持Claude Cod" data-v-21339fef="">
              程序员福利！GitHub最火的Spec Kit项目深度解析：只需7条命令就能实现规格驱动开发，告别繁琐的PRD文档，让规范直接生成代码！支持Claude Cod
            </a> <a data-v-f33c35a0="" href="/post/7557921840553164841" class="info" target="_blank" title="程序员福利！GitHub最火的Spec Kit项目深度解析：只需7条命令就能实现规格驱动开发，告别繁琐的PRD文档，让规范直接生成代码！支持Claude Cod" data-v-21339fef=""></a> <!----></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-article"><div data-v-f33c35a0="" data-v-21339fef="" class="body-index">
            4
          </div> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-article"><a data-v-f33c35a0="" href="/post/7558616190953127977" class="title-articles" target="_blank" title="AI 时代，每个程序员都该拥有个人提示词库：从效率工具到战略资产的蜕变" data-v-21339fef="">
              AI 时代，每个程序员都该拥有个人提示词库：从效率工具到战略资产的蜕变
            </a> <a data-v-f33c35a0="" href="/post/7558616190953127977" class="info" target="_blank" title="AI 时代，每个程序员都该拥有个人提示词库：从效率工具到战略资产的蜕变" data-v-21339fef=""></a> <!----></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-article"><div data-v-f33c35a0="" data-v-21339fef="" class="body-index">
            5
          </div> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-article"><a data-v-f33c35a0="" href="/post/7559009457171857450" class="title-articles" target="_blank" title="Claude Code Review：让AI审核更懂你的代码" data-v-21339fef="">
              Claude Code Review：让AI审核更懂你的代码
            </a> <a data-v-f33c35a0="" href="/post/7559009457171857450" class="info" target="_blank" title="Claude Code Review：让AI审核更懂你的代码" data-v-21339fef=""></a> <!----></div></li></div></ul> <div data-v-f33c35a0="" class="divider" style="margin-top: 4px;"><div data-v-f33c35a0="" class="content"></div></div> <div data-v-f33c35a0="" class="hot-item-footer"><a data-v-f33c35a0="" href="/hot/articles/6809637773935378440" class="item-footer-button" target="_blank"><span data-v-f33c35a0="" class="">查看更多</span> <svg data-v-f33c35a0="" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><path data-v-f33c35a0="" d="M6.6094 4.99959L3.22118 1.61137C3.13982 1.53001 3.13982 1.3981 3.22118 1.31674L3.5158 1.02212C3.59716 0.940757 3.72907 0.940757 3.81043 1.02212L7.49328 4.70496C7.656 4.86768 7.656 5.1315 7.49328 5.29422L3.81043 8.97707C3.72907 9.05843 3.59716 9.05843 3.5158 8.97707L3.22118 8.68244C3.13982 8.60108 3.13982 8.46917 3.22118 8.38781L6.6094 4.99959Z"></path></svg></a></div></div></div> <div data-v-f33c35a0="" data-v-4e378738="" class="hot-list-container"><div data-v-f33c35a0="" class="hot-list-item"><div data-v-f33c35a0="" class="hot-item-header"><div data-v-f33c35a0="" class="hot-title"><img data-v-f33c35a0="" src="https://p9-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/a3682760be834d9c8b28e45cb9213874~tplv-k3u1fbpfcp-watermark.image?" type="icon" alt="icon" class="hot-icon"> <span data-v-f33c35a0="" title="作者榜" class="title-text">
          作者榜
        </span></div> <div data-v-f33c35a0="" class="item-header-button"><svg data-v-f33c35a0="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><path data-v-f33c35a0="" fill-rule="evenodd" clip-rule="evenodd" d="M9.66667 6.66667C9.48257 6.66667 9.33333 6.51743 9.33333 6.33333V5.66667C9.33333 5.48257 9.48257 5.33333 9.66667 5.33333L11.8303 5.3334C10.987 4.12437 9.58586 3.33333 8 3.33333C5.42267 3.33333 3.33333 5.42267 3.33333 8C3.33333 10.5773 5.42267 12.6667 8 12.6667C10.1139 12.6667 11.8996 11.2611 12.4733 9.33358L13.8513 9.33355C13.2449 12.0054 10.8554 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C9.88507 2 11.5671 2.86932 12.6671 4.22893L12.6667 2.33333C12.6667 2.14924 12.8159 2 13 2H13.6667C13.8508 2 14 2.14924 14 2.33333V6C14 6.35145 13.728 6.63939 13.3831 6.66484L13.3333 6.66667H9.66667Z" fill="#8A919F"></path></svg> <span data-v-f33c35a0="" class="text">换一换</span></div></div> <div data-v-f33c35a0="" class="divider" style="margin-bottom: 4px;"><div data-v-f33c35a0="" class="content"></div></div> <ul data-v-f33c35a0="" class="hot-item-body"><div data-v-21339fef="" data-v-f33c35a0="" class="skeleton"><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-authors"><!----> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-authors"><!----> <a data-v-f33c35a0="" href="/user/3825956195409223" class="info" target="_blank" title="飞哥数智谈" data-v-21339fef=""><img data-v-f33c35a0="" src="https://p26-passport.byteacctimg.com/img/user-avatar/df140ad36777244ec0f8799caa69c6e8~300x300.image" alt="avatar" type="avatar" class="hot-item-img"></a> <span data-v-f33c35a0="" data-v-21339fef="" class="title-authors"><a data-v-f33c35a0="" href="/user/3825956195409223" class="info" target="_blank" title="飞哥数智谈" data-v-21339fef=""><span data-v-f33c35a0="" class="title">飞哥数智谈</span> <span data-v-f33c35a0="" class="description">
                  作者暂无简介
                </span></a> <div data-v-f33c35a0="" data-v-21339fef="" class="action"><div data-v-f33c35a0="" data-v-21339fef="" class="follow-wrap"><button data-v-f33c35a0="" type="button" class="follow byte-btn byte-btn--text byte-btn--normal" data-v-21339fef=""><!----><!----><span class="">
                    + 关注
                  </span></button></div></div></span></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-authors"><!----> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-authors"><!----> <a data-v-f33c35a0="" href="/user/2942757076730455" class="info" target="_blank" title="倔强青铜三" data-v-21339fef=""><img data-v-f33c35a0="" src="https://p26-passport.byteacctimg.com/img/user-avatar/9f49034a7afdfdcf036982ace70d5911~300x300.image" alt="avatar" type="avatar" class="hot-item-img"></a> <span data-v-f33c35a0="" data-v-21339fef="" class="title-authors"><a data-v-f33c35a0="" href="/user/2942757076730455" class="info" target="_blank" title="倔强青铜三" data-v-21339fef=""><span data-v-f33c35a0="" class="title">倔强青铜三</span> <span data-v-f33c35a0="" class="description">
                  软件工程师
                </span></a> <div data-v-f33c35a0="" data-v-21339fef="" class="action"><div data-v-f33c35a0="" data-v-21339fef="" class="follow-wrap"><button data-v-f33c35a0="" type="button" class="follow byte-btn byte-btn--text byte-btn--normal" data-v-21339fef=""><!----><!----><span class="">
                    + 关注
                  </span></button></div></div></span></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-authors"><!----> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-authors"><!----> <a data-v-f33c35a0="" href="/user/3140624091453053" class="info" target="_blank" title="大模型真好玩" data-v-21339fef=""><img data-v-f33c35a0="" src="https://p6-passport.byteacctimg.com/img/user-avatar/9b76634363d5598664a045d6a301adea~300x300.image" alt="avatar" type="avatar" class="hot-item-img"></a> <span data-v-f33c35a0="" data-v-21339fef="" class="title-authors"><a data-v-f33c35a0="" href="/user/3140624091453053" class="info" target="_blank" title="大模型真好玩" data-v-21339fef=""><span data-v-f33c35a0="" class="title">大模型真好玩</span> <span data-v-f33c35a0="" class="description">
                  人工智能大模型 @alibaba
                </span></a> <div data-v-f33c35a0="" data-v-21339fef="" class="action"><div data-v-f33c35a0="" data-v-21339fef="" class="follow-wrap"><button data-v-f33c35a0="" type="button" class="follow byte-btn byte-btn--text byte-btn--normal" data-v-21339fef=""><!----><!----><span class="">
                    + 关注
                  </span></button></div></div></span></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-authors"><!----> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-authors"><!----> <a data-v-f33c35a0="" href="/user/52383084474680" class="info" target="_blank" title="编程干货铺" data-v-21339fef=""><img data-v-f33c35a0="" src="https://p3-passport.byteacctimg.com/img/user-avatar/46f56f61433857a43209e57286eaa039~300x300.image" alt="avatar" type="avatar" class="hot-item-img"></a> <span data-v-f33c35a0="" data-v-21339fef="" class="title-authors"><a data-v-f33c35a0="" href="/user/52383084474680" class="info" target="_blank" title="编程干货铺" data-v-21339fef=""><span data-v-f33c35a0="" class="title">编程干货铺</span> <span data-v-f33c35a0="" class="description">
                  前端开发工程师 @平安中心
                </span></a> <div data-v-f33c35a0="" data-v-21339fef="" class="action"><div data-v-f33c35a0="" data-v-21339fef="" class="follow-wrap"><button data-v-f33c35a0="" type="button" class="follow byte-btn byte-btn--text byte-btn--normal" data-v-21339fef=""><!----><!----><span class="">
                    + 关注
                  </span></button></div></div></span></div></li><li data-v-f33c35a0="" data-v-21339fef="" class="hot-item hot-item-authors"><!----> <div data-v-f33c35a0="" data-v-21339fef="" class="hot-item-text hot-item-text-authors"><!----> <a data-v-f33c35a0="" href="/user/976781670357400" class="info" target="_blank" title="小溪彼岸" data-v-21339fef=""><img data-v-f33c35a0="" src="https://p3-passport.byteacctimg.com/img/user-avatar/02602fae05f3d58d4b8cae11ee852f74~300x300.image" alt="avatar" type="avatar" class="hot-item-img"></a> <span data-v-f33c35a0="" data-v-21339fef="" class="title-authors"><a data-v-f33c35a0="" href="/user/976781670357400" class="info" target="_blank" title="小溪彼岸" data-v-21339fef=""><span data-v-f33c35a0="" class="title">小溪彼岸</span> <span data-v-f33c35a0="" class="description">
                  前后端、国学爱好者
                </span></a> <div data-v-f33c35a0="" data-v-21339fef="" class="action"><div data-v-f33c35a0="" data-v-21339fef="" class="follow-wrap"><button data-v-f33c35a0="" type="button" class="follow byte-btn byte-btn--text byte-btn--normal" data-v-21339fef=""><!----><!----><span class="">
                    + 关注
                  </span></button></div></div></span></div></li></div></ul> <div data-v-f33c35a0="" class="divider" style="margin-top: 4px;"><div data-v-f33c35a0="" class="content"></div></div> <div data-v-f33c35a0="" class="hot-item-footer"><a data-v-f33c35a0="" href="/hot/authors/6809637773935378440" class="item-footer-button" target="_blank"><span data-v-f33c35a0="" class="">查看更多</span> <svg data-v-f33c35a0="" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><path data-v-f33c35a0="" d="M6.6094 4.99959L3.22118 1.61137C3.13982 1.53001 3.13982 1.3981 3.22118 1.31674L3.5158 1.02212C3.59716 0.940757 3.72907 0.940757 3.81043 1.02212L7.49328 4.70496C7.656 4.86768 7.656 5.1315 7.49328 5.29422L3.81043 8.97707C3.72907 9.05843 3.59716 9.05843 3.5158 8.97707L3.22118 8.68244C3.13982 8.60108 3.13982 8.46917 3.22118 8.38781L6.6094 4.99959Z"></path></svg></a></div></div></div></div> <div data-v-f33c35a0="" data-v-4e378738="" class="hot-list-container"></div> <div data-fetch-key="data-v-3ea9885c:0" class="list_box hot-theme" data-v-3ea9885c="" data-v-4e378738=""><p class="title" data-v-3ea9885c="">
    推荐话题
    <span class="refresh" data-v-3ea9885c=""><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" data-v-3ea9885c="" class=""><path fill-rule="evenodd" clip-rule="evenodd" d="M9.66667 6.66667C9.48257 6.66667 9.33333 6.51743 9.33333 6.33333V5.66667C9.33333 5.48257 9.48257 5.33333 9.66667 5.33333L11.8303 5.3334C10.987 4.12437 9.58586 3.33333 8 3.33333C5.42267 3.33333 3.33333 5.42267 3.33333 8C3.33333 10.5773 5.42267 12.6667 8 12.6667C10.1139 12.6667 11.8996 11.2611 12.4733 9.33358L13.8513 9.33355C13.2449 12.0054 10.8554 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C9.88507 2 11.5671 2.86932 12.6671 4.22893L12.6667 2.33333C12.6667 2.14924 12.8159 2 13 2H13.6667C13.8508 2 14 2.14924 14 2.33333V6C14 6.35145 13.728 6.63939 13.3831 6.66484L13.3333 6.66667H9.66667Z" fill="#8A919F" data-v-3ea9885c=""></path></svg>
      换一换
    </span></p> <div data-v-3ea9885c="" class="theme_list"><a data-v-3ea9885c="" href="/pin/topic/7210002980895916043" class="item" target="_blank"><p data-v-3ea9885c="" class="content"><img data-v-3ea9885c="" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/img/rec.476fe07.png" alt="" class="tag"> <!----> 233<span data-v-3ea9885c="" class=""><span class="byte-tooltip__wrapper"><span data-v-3ea9885c="" class="content-label">#挑战每日一条沸点#</span></span></span></p> <p data-v-3ea9885c="" class="hot">20.4m</p></a><a data-v-3ea9885c="" href="/theme/detail/7490464890612629541?contentType=0" class="item" target="_blank"><p data-v-3ea9885c="" class="content"><img data-v-3ea9885c="" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/img/rec.476fe07.png" alt="" class="tag"> <!----> <span data-v-3ea9885c="" class="">
 我2           #金石焕新程#
          </span></p> <p data-v-3ea9885c="" class="hot">5.6m</p></a><a data-v-3ea9885c="" href="/pin/topic/7210228048107896891" class="item" target="_blank"><p data-v-3ea9885c="" class="content"><img data-v-3ea9885c="" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/img/rec.476fe07.png" alt="" class="tag"> <!----> <span data-v-3ea9885c="" class="">
            #每日快讯#
          </span></p> <p data-v-3ea9885c="" class="hot">9.2m</p></a><a data-v-3ea9885c="" href="/theme/detail/7487778802563547174?contentType=0" class="item" target="_blank"><p data-v-3ea9885c="" class="content"><img data-v-3ea9885c="" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/img/rec.476fe07.png" alt="" class="tag"> <!----> <span data-v-3ea9885c="" class="">
            #MCP 怎么玩#
          </span></p> <p data-v-3ea9885c="" class="hot">725k</p></a><a data-v-3ea9885c="" href="/theme/detail/7243698841848348730?contentType=0" class="item" target="_blank"><p data-v-3ea9885c="" class="content"><img data-v-3ea9885c="" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/img/rec.476fe07.png" alt="" class="tag"> <!----> <span data-v-3ea9885c="" class="">
            #每天一个知识点#
          </span></p> <p data-v-3ea9885c="" class="hot">42.0m</p></a><a data-v-3ea9885c="" href="/theme/detail/7073670907851440160?contentType=0" class="item" target="_blank"><p data-v-3ea9885c="" class="content"><!----> <!----> <span data-v-3ea9885c="" class="">
            #新人报道#
          </span></p> <p data-v-3ea9885c="" class="hot">35.3m</p></a><a data-v-3ea9885c="" href="/pin/topic/7230703551264079928" class="item" target="_blank"><p data-v-3ea9885c="" class="content"><img data-v-3ea9885c="" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/img/rec.476fe07.png" alt="" class="tag"> <!----> <span data-v-3ea9885c="" class=""><span class="byte-tooltip__wrapper"><span data-v-3ea9885c="" class="content-label">#工作中做得最正确的一件事#</span></span></span></p> <p data-v-3ea9885c="" class="hot">351k</p></a><a data-v-3ea9885c="" href="/theme/detail/7218019389664067621?contentType=0" class="item" target="_blank"><p data-v-3ea9885c="" class="content"><!----> <!----> <span data-v-3ea9885c="" class=""><span class="byte-tooltip__wrapper"><span data-v-3ea9885c="" class="content-label">#金石计划征文活动#</span></span></span></p> <p data-v-3ea9885c="" class="hot">36.6m</p></a><a data-v-3ea9885c="" href="/theme/detail/7476000490959044659?contentType=0" class="item" target="_blank"><p data-v-3ea9885c="" class="content"><img data-v-3ea9885c="" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/img/rec.476fe07.png" alt="" class="tag"> <!----> <span data-v-3ea9885c="" class="">
            #掘金一周#
          </span></p> <p data-v-3ea9885c="" class="hot">927k</p></a><a data-v-3ea9885c="" href="/theme/detail/7215101716402798596?contentType=0" class="item" target="_blank"><p data-v-3ea9885c="" class="content"><!----> <!----> <span data-v-3ea9885c="" class=""><span class="byte-tooltip__wrapper"><span data-v-3ea9885c="" class="content-label">#我的技术写作成长之路#</span></span></span></p> <p data-v-3ea9885c="" class="hot">8.4m</p></a></div> <a data-v-3ea9885c="" href="/pin/topics" class="moreTopics" target="_blank">
      查看更多
      <svg data-v-3ea9885c="" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><path data-v-3ea9885c="" fill-rule="evenodd" clip-rule="evenodd" d="M8.13909 6.00049L4.07322 1.93463C3.97559 1.837 3.97559 1.6787 4.07322 1.58107L4.42678 1.22752C4.52441 1.12989 4.6827 1.12989 4.78033 1.22752L9.19975 5.64694C9.39501 5.8422 9.39501 6.15878 9.19975 6.35404L4.78033 10.7735C4.6827 10.8711 4.52441 10.8711 4.42678 10.7735L4.07322 10.4199C3.97559 10.3223 3.97559 10.164 4.07322 10.0664L8.13909 6.00049Z" fill="#8A919F"></path></svg></a></div> <div class="index-aside-footer" data-v-0bb7cad4="" data-v-4e378738=""><ul class="more-list" data-v-0bb7cad4=""><li class="item" data-v-0bb7cad4=""><a href="/terms" target="_blank" rel="nofollow" class="jj-link" data-v-65b50b51="" data-v-0bb7cad4="">用户协议</a></li> <li class="item" data-v-0bb7cad4=""><a href="/license" target="_blank" rel="nofollow" class="jj-link" data-v-65b50b51="" data-v-0bb7cad4="">
        营业执照
      </a></li> <li class="item" data-v-0bb7cad4=""><a href="/privacy" target="_blank" rel="nofollow" class="jj-link" data-v-65b50b51="" data-v-0bb7cad4="">隐私政策</a></li> <li class="item" data-v-0bb7cad4=""><a href="/about" target="_blank" rel="nofollow" class="jj-link" data-v-65b50b51="" data-v-0bb7cad4="">关于我们</a></li></ul> <ul class="more-list" data-v-0bb7cad4=""><li class="item" data-v-0bb7cad4=""><a data-v-0bb7cad4="" href="/book/5c90640c5188252d7941f5bb" target="_blank" class="">使用指南</a></li> <li class="item" data-v-0bb7cad4=""><a href="/links" target="_blank" rel="" class="jj-link" data-v-65b50b51="" data-v-0bb7cad4="">友情链接</a></li> <li class="item" data-v-0bb7cad4=""><a href="/more_posts/ai" target="_blank" rel="" class="jj-link" data-v-65b50b51="" data-v-0bb7cad4="">
        更多人工智能文章
      </a></li></ul> <ul class="more-list" data-v-0bb7cad4=""><li class="item" data-v-0bb7cad4=""><span data-v-0bb7cad4="" class="">
        举报邮箱：
        <a href="mailto:feedback@xitu.io" data-v-0bb7cad4="" class="">feedback@xitu.io</a></span></li></ul> <ul class="more-list" data-v-0bb7cad4=""><li class="item" data-v-0bb7cad4=""><span data-v-0bb7cad4="" class="">
        座机电话：
        <a href="tel:010-83434395" data-v-0bb7cad4="" class="">010-83434395</a></span></li></ul> <ul class="more-list" data-v-0bb7cad4=""><li class="item" data-v-0bb7cad4=""><a href="https://beian.miit.gov.cn" target="_blank" rel="nofollow" class="jj-link" data-v-65b50b51="" data-v-0bb7cad4="">
        京ICP备：18012699号-3
      </a></li></ul> <ul class="more-list" data-v-0bb7cad4=""><li class="item" data-v-0bb7cad4=""><a href="https://lf3-static.bytednsdoc.com/obj/eden-cn/ulojuhieh7plmhfps/jujin/20240606-112720.png" target="_blank" rel="nofollow" class="jj-link" data-v-65b50b51="" data-v-0bb7cad4="">
        京ICP证：京B2-20191272
      </a></li></ul> <ul class="more-list" data-v-0bb7cad4=""><li class="item" data-v-0bb7cad4=""><a href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=11010802026719" target="_blank" rel="nofollow" class="jj-link" data-v-65b50b51="" data-v-0bb7cad4=""><img src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/img/police.d0289dc.png" alt="police" style="vertical-align:middle;" data-v-65b50b51="" data-v-0bb7cad4="" class="">
        京公网安备11010802026719号
      </a></li></ul> <ul class="more-list" data-v-0bb7cad4=""><li class="item" data-v-0bb7cad4=""><span data-v-0bb7cad4="" class="">©2025 稀土掘金</span></li></ul></div></aside></div></div></div></main> <div data-v-644f89e1="" data-v-539963b4="" class="open-button app-open-button">
  APP内打开
</div></div> <!----></div> <!----> <div class="global-component-box"><div data-v-262fe4c6="" class="alert-list"></div> <div data-v-ce04894c="" class="suspension-panel"><!----> <div data-v-ce04894c="" id="wechat-assets__global-right-bottom" class=""></div> <div data-v-ce04894c="" class="btn btn-ai" style="display: none;"><svg data-v-ce04894c="" width="24" height="18" viewBox="0 0 24 18" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><path data-v-ce04894c="" fill-rule="evenodd" clip-rule="evenodd" d="M11.9999 4.35298H12.0015L14.7242 2.18792L12.0015 0.00304724L11.9984 0L9.28027 2.18335L11.9984 4.35146L11.9999 4.35298ZM12.0004 11.1834L12.002 11.1818L19.0259 5.64043L17.1213 4.11072L12.002 8.14983L12.0004 8.15136L11.9989 8.15288L6.87956 4.11377L4.97656 5.64348L11.9989 11.1849L12.0004 11.1834ZM11.9971 14.971L12.0001 14.9695L21.4039 7.54944L23.3084 9.07915L19.0301 12.454L12.0001 17.9999L0.876194 9.22847L0.693359 9.08372L2.59788 7.55401L11.9971 14.971Z" fill="#1E80FF"></path></svg></div> <button data-v-ce04894c="" title="建议反馈" class="btn btn-hover meiqia-btn" style=""><svg data-v-ce04894c="" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><path data-v-ce04894c="" d="M3.26628 5.18082C3.26628 4.35104 3.94716 3.67545 4.7907 3.67545H15.2093C16.0528 3.67545 16.7337 4.35104 16.7337 5.18082V12.538C16.7337 13.3678 16.0528 14.0434 15.2093 14.0434H11.6358C11.4624 14.0434 11.2948 14.1064 11.165 14.221L8.28954 16.7575V14.7452C8.28954 14.356 7.97087 14.0434 7.5814 14.0434H4.7907C3.94716 14.0434 3.26628 13.3678 3.26628 12.538V5.18082ZM4.7907 2.27187C3.16822 2.27187 1.85 3.57264 1.85 5.18082V12.538C1.85 14.1462 3.16822 15.447 4.7907 15.447H6.87326V17.5004C6.87326 18.4274 7.97825 18.9111 8.67204 18.2991L11.9053 15.447H15.2093C16.8318 15.447 18.15 14.1462 18.15 12.538V5.18082C18.15 3.57264 16.8318 2.27187 15.2093 2.27187H4.7907Z" fill="#1E80FF" stroke="#1E80FF" stroke-width="0.3" stroke-linejoin="round"></path><path data-v-ce04894c="" d="M7.00132 9.49204C6.79163 9.17668 6.366 9.09101 6.05063 9.3007C5.73527 9.51038 5.6496 9.93602 5.85929 10.2514C6.74878 11.5891 8.27183 12.4732 10.0017 12.4732C11.7316 12.4732 13.2546 11.5891 14.1441 10.2514C14.3538 9.93602 14.2681 9.51038 13.9528 9.3007C13.6374 9.09101 13.2118 9.17668 13.0021 9.49204C12.356 10.4637 11.2532 11.1018 10.0017 11.1018C8.75017 11.1018 7.64741 10.4637 7.00132 9.49204Z" fill="#1E80FF" stroke="#1E80FF" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round"></path></svg></button> <span data-v-ce04894c="" class="more-btn"><div class="byte-popover" x-placement="left-end" style="display: none; position: absolute; width: 200px; max-width: none; will-change: transform; z-index: 1006; top: 0px; left: 0px; transform: translate3d(-10px, 103px, 0px);"><!----><p class="byte-popover__content"><ul data-v-ce04894c="" class="link-list"><li data-v-ce04894c="" class="item"><span data-v-ce04894c="" class="download-popover"><div class="byte-popover" x-placement="right-start" x-out-of-boundaries="" style="display: none; position: absolute; width: 200px; max-width: none; will-change: transform; z-index: 1004; top: 0px; left: 0px; transform: translate3d(5px, 0px, 0px);"><!----><p class="byte-popover__content"><div data-v-ce04894c="" class="wrap"><img data-v-5244ef91="" data-v-ce04894c="" src="https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/2ad212d53ccd44569d10317171664bae~tplv-k3u1fbpfcp-jj:180:0:0:0:q75.avis" alt="下载掘金APP" class="lazy qrcode" loading="lazy"> <span data-v-ce04894c="" class="text">下载APP</span></div></p><!----><div x-arrow="" class="popper__arrow" style="top: 0px;"></div></div><a data-v-ce04894c="" class="link" target="_blank"><svg data-v-ce04894c="" width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon"><path data-v-ce04894c="" fill-rule="evenodd" clip-rule="evenodd" d="M17.8867 3.22968C17.8867 1.93384 16.9412 0.882812 15.7762 0.882812H5.22377C4.05878 0.882812 3.11328 1.93384 3.11328 3.22968V16.7706C3.11328 18.0664 4.05878 19.1175 5.22377 19.1175H15.7762C16.9412 19.1175 17.8867 18.0707 17.8867 16.7748V3.22968ZM5.22377 2.2884H15.7762C15.7762 2.2884 15.8438 2.29262 15.8395 2.29684C16.1688 2.34327 16.4769 2.71472 16.4769 3.22968V12.2867C16.4769 12.9494 15.9397 13.4867 15.2769 13.4867H5.71887C5.05613 13.4867 4.51887 12.9494 4.51887 12.2867V3.22546L4.52309 3.12415C4.5653 2.6303 4.89454 2.2884 5.22377 2.2884ZM11.1458 4.71124C11.1458 4.32291 10.8292 4.00634 10.4409 4.00634H10.4325C10.0441 4.00634 9.72756 4.32291 9.72756 4.71124V9.05463L8.93402 8.17245L8.87492 8.11336C8.60056 7.87276 8.18268 7.89809 7.93786 8.17245L7.86189 8.26109L7.80701 8.33285C7.62129 8.59877 7.64662 8.96177 7.86189 9.20237L9.93861 11.5197L10.0061 11.583C10.1454 11.7012 10.3227 11.7561 10.5 11.7392C10.711 11.7603 10.9179 11.6759 11.0614 11.5197L13.1423 9.20659C13.3829 8.94067 13.3829 8.53545 13.1423 8.26953L13.0621 8.18089L13.0115 8.13024C12.7329 7.8812 12.3108 7.90653 12.0618 8.18089L11.1458 9.19815V4.71124ZM9.81709 15.2837C9.48571 15.2837 9.21709 15.5523 9.21709 15.8837C9.21709 16.215 9.48571 16.4837 9.81709 16.4837L11.1847 16.4837C11.5161 16.4837 11.7847 16.215 11.7847 15.8837C11.7847 15.5523 11.5161 15.2837 11.1847 15.2837H9.81709Z" fill="#86909C"></path></svg> <span data-v-ce04894c="" class="title">下载APP</span></a></span></li> <li data-v-ce04894c="" class="item"><span data-v-ce04894c="" class="wechat-popover"><div class="byte-popover" x-placement="right" x-out-of-boundaries="" style="display: none; position: absolute; width: 200px; max-width: none; will-change: transform; z-index: 1005; top: 0px; left: 0px; transform: translate3d(5px, 0px, 0px);"><!----><p class="byte-popover__content"><div data-v-ce04894c="" class="wrap"><img data-v-5244ef91="" data-v-ce04894c="" src="https://p9-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/9f4933cc8fdb411cba89904f14a3ec0a~tplv-k3u1fbpfcp-jj:180:0:0:0:q75.avis" alt="微信扫一扫" class="lazy qrcode" loading="lazy"> <span data-v-ce04894c="" class="text">微信扫一扫</span></div></p><!----><div x-arrow="" class="popper__arrow" style="top: 0px;"></div></div><a data-v-ce04894c="" class="link" target="_blank"><svg data-v-ce04894c="" width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon"><path data-v-ce04894c="" fill-rule="evenodd" clip-rule="evenodd" d="M14.058 5.34061C12.5478 2.85722 9.40935 1.73257 6.61837 2.05358C5.06438 2.23231 3.54515 2.85861 2.38488 3.92471C1.50713 4.72863 0.854706 5.78486 0.610133 6.95889C0.31238 8.37395 0.62606 9.85314 1.45797 11.0298C1.79007 11.4994 2.18504 11.9193 2.61976 12.2941C2.7516 12.4079 2.88718 12.5172 3.02567 12.6228C3.09325 12.6742 3.16139 12.7249 3.23036 12.7745C3.24219 12.7831 3.25416 12.7902 3.26537 12.7969C3.30414 12.8201 3.33375 12.8378 3.31678 12.8887L3.17482 13.3177C3.04011 13.7252 2.90517 14.1325 2.77023 14.5399C2.72108 14.6883 2.67194 14.8366 2.6228 14.985L3.11597 14.7368C3.35739 14.6151 3.59888 14.4935 3.84037 14.3719C4.08124 14.2507 4.32211 14.1294 4.56291 14.0081L4.90927 13.8337C4.92499 13.8257 4.94129 13.8164 4.958 13.8069C5.01783 13.7728 5.0829 13.7356 5.14526 13.7481C5.26637 13.7723 5.38733 13.7972 5.50826 13.8221C5.58119 13.8372 5.65411 13.8522 5.72705 13.867C6.56311 14.0373 7.38533 14.1348 8.23884 14.0675C7.94884 13.0669 7.94939 12.0016 8.25615 11.0045C8.59877 9.88624 9.31463 8.89831 10.2447 8.19773C11.5173 7.23915 13.1433 6.81493 14.7214 6.99199C14.5897 6.4081 14.3691 5.85148 14.058 5.34061ZM5.28108 5.01953C4.78279 5.01953 4.21484 5.3532 4.21484 5.90635C4.21484 6.45894 4.78251 6.7965 5.28108 6.7965C5.79418 6.7965 6.16478 6.42097 6.16478 5.90635C6.16478 5.39117 5.7939 5.01953 5.28108 5.01953ZM11.1173 5.90635C11.1173 6.4225 10.745 6.7965 10.2312 6.7965C9.73231 6.7965 9.16797 6.45838 9.16797 5.90635C9.16797 5.35376 9.73259 5.01953 10.2312 5.01953C10.7447 5.01953 11.1173 5.38964 11.1173 5.90635ZM18.2917 8.53765C15.8558 6.80407 12.2345 6.93287 10.031 9.01026C9.27834 9.721 8.72965 10.6477 8.54116 11.6736C8.28343 13.0791 8.72591 14.5433 9.67359 15.6042C10.568 16.6055 11.7894 17.2556 13.0991 17.5158C13.9222 17.6798 14.7564 17.6923 15.5805 17.5336C15.7868 17.494 15.9916 17.4473 16.1959 17.3977C16.2832 17.3766 16.3703 17.355 16.4574 17.3332C16.466 17.331 16.479 17.3264 16.4939 17.3211L16.4939 17.3211C16.5365 17.3059 16.5954 17.2849 16.6186 17.2976C16.7479 17.3685 16.877 17.4396 17.0061 17.5108L17.0072 17.5114L17.5563 17.8134L17.5583 17.8145C17.8904 17.9971 18.2226 18.1797 18.5545 18.3626C18.4751 18.0962 18.3952 17.8299 18.3153 17.5636L18.1755 17.0973L18.082 16.7855L18.0338 16.6248C18.0164 16.5667 18.0932 16.5174 18.1561 16.4771C18.1759 16.4645 18.1942 16.4527 18.2079 16.4418C18.5613 16.1614 18.8958 15.855 19.1968 15.5183C19.6838 14.9739 20.0901 14.349 20.3167 13.6496C20.5128 13.0382 20.5493 12.3912 20.4383 11.7596C20.2103 10.4372 19.3648 9.30429 18.2917 8.53765ZM15.7414 11.0059C15.6613 10.6097 16.0352 10.1797 16.4328 10.1797C16.8082 10.1797 17.2427 10.394 17.3114 10.7999C17.3742 11.1704 17.0579 11.4706 16.7288 11.5626C16.305 11.6811 15.8344 11.4658 15.7414 11.0059ZM12.5355 10.1797C12.1376 10.1797 11.758 10.6074 11.8392 11.0059C11.9332 11.4676 12.4088 11.681 12.8334 11.5626C13.1633 11.4706 13.476 11.1704 13.4141 10.7999C13.3459 10.3924 12.9119 10.1797 12.5355 10.1797Z" fill="#8A919F"></path></svg> <span data-v-ce04894c="" class="title">微信公众号</span></a></span></li> <li data-v-ce04894c="" class="item"><a data-v-ce04894c="" href="https://weibo.com/xitucircle" target="_blank" class="link"><svg data-v-ce04894c="" width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon"><path data-v-ce04894c="" fill-rule="evenodd" clip-rule="evenodd" d="M0.5 13.0991C0.5 8.7083 7.11474 3.50113 9.68032 4.57125C10.672 4.98488 10.474 6.17003 10.3544 6.88649C10.3071 7.16936 10.2721 7.37918 10.3273 7.43961C10.4295 7.55147 10.7957 7.42127 11.2997 7.24214C12.3364 6.8736 13.9559 6.29793 15.0569 7.1969C15.7667 7.77649 15.466 8.72455 15.2908 9.27677C15.2292 9.47083 15.1831 9.61601 15.2019 9.67913C15.2412 9.81126 15.4861 9.91207 15.8173 10.0484C16.4263 10.2991 17.3272 10.6699 17.7786 11.5767C18.8718 13.772 15.7039 18.2511 9.12259 18.2511C3.75048 18.2511 0.5 15.6696 0.5 13.0991ZM8.95153 17.0592C12.2717 16.7415 14.7929 14.7419 14.5826 12.5929C14.3724 10.444 11.5104 8.95949 8.19024 9.2772C4.87003 9.59491 2.3489 11.5945 2.55912 13.7435C2.76935 15.8924 5.63133 17.3769 8.95153 17.0592Z" fill="#8A919F"></path><path data-v-ce04894c="" fill-rule="evenodd" clip-rule="evenodd" d="M11.2088 12.7026C11.6152 14.1389 10.5594 15.6866 8.8506 16.1596C7.14177 16.6326 5.42703 15.8517 5.02062 14.4154C4.61421 12.9791 5.67002 11.4314 7.37885 10.9584C9.08767 10.4855 10.8024 11.2664 11.2088 12.7026ZM8.16929 13.628C8.39522 14.1086 8.11653 14.7106 7.54682 14.9726C6.9771 15.2345 6.3321 15.0572 6.10617 14.5766C5.88024 14.096 6.15893 13.494 6.72864 13.232C7.29835 12.9701 7.94335 13.1474 8.16929 13.628ZM8.91649 13.378C9.13847 13.276 9.24707 13.0414 9.15903 12.8541C9.071 12.6668 8.81967 12.5978 8.59768 12.6998C8.3757 12.8019 8.2671 13.0365 8.35514 13.2237C8.44317 13.411 8.6945 13.4801 8.91649 13.378Z" fill="#8A919F"></path><path data-v-ce04894c="" d="M14.1494 3.54836C14.4537 3.47388 14.7726 3.43418 15.1019 3.43418C17.2827 3.43418 19.0506 5.18267 19.0506 7.33955C19.0506 7.81593 18.9647 8.27085 18.808 8.69104C18.6694 9.06261 18.8616 9.47493 19.2373 9.61199C19.613 9.74904 20.0299 9.55894 20.1685 9.18737C20.3836 8.61063 20.5007 7.98781 20.5007 7.33955C20.5007 4.3906 18.0836 2 15.1019 2C14.6543 2 14.2184 2.05403 13.801 2.15619C13.4123 2.25133 13.1752 2.64011 13.2714 3.02455C13.3676 3.40899 13.7607 3.6435 14.1494 3.54836Z" fill="#8A919F"></path><path data-v-ce04894c="" d="M14.7901 6.05162C14.8894 6.02824 14.9937 6.01569 15.1019 6.01569C15.8411 6.01569 16.4404 6.6084 16.4404 7.33955C16.4404 7.49914 16.4122 7.65062 16.361 7.7904C16.2246 8.16277 16.4193 8.57396 16.7958 8.70881C17.1723 8.84366 17.5881 8.65112 17.7245 8.27875C17.8321 7.98466 17.8905 7.66805 17.8905 7.33955C17.8905 5.81633 16.642 4.58152 15.1019 4.58152C14.8798 4.58152 14.6628 4.60734 14.4543 4.65643C14.0647 4.74813 13.8241 5.1348 13.9169 5.52008C14.0096 5.90535 14.4005 6.14333 14.7901 6.05162Z" fill="#8A919F"></path></svg> <span data-v-ce04894c="" class="title">新浪微博</span></a></li></ul></p><!----><div x-arrow="" class="popper__arrow"></div></div><button data-v-ce04894c="" title="更多" class="btn btn-hover"><svg data-v-ce04894c="" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class=""><circle data-v-ce04894c="" cx="2.33301" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-ce04894c="" cx="8" cy="8" r="1.0625" fill="#8A919F"></circle><circle data-v-ce04894c="" cx="13.667" cy="8" r="1.0625" fill="#8A919F"></circle></svg></button></span> <button data-v-ce04894c="" title="回到顶部" class="btn btn-hover to-top-btn" style="display: none;"><svg data-v-ce04894c="" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon-top"><path data-v-ce04894c="" fill-rule="evenodd" clip-rule="evenodd" d="M5.00806 3.0625C4.70158 3.0625 4.45312 3.31095 4.45312 3.61743C4.45312 3.92391 4.70158 4.17236 5.00806 4.17236H14.9968C15.3033 4.17236 15.5518 3.92391 15.5518 3.61743C15.5518 3.31095 15.3033 3.0625 14.9968 3.0625H5.00806ZM10.3948 5.9997C10.1781 5.78297 9.82676 5.78297 9.61005 5.9997L6.07849 9.53126C5.86176 9.74797 5.86176 10.0993 6.07849 10.316C6.2952 10.5328 6.64656 10.5328 6.86327 10.316L9.44751 7.73182V17.3809C9.44751 17.6873 9.69596 17.9358 10.0024 17.9358C10.3089 17.9358 10.5574 17.6873 10.5574 17.3809V7.73182L13.1416 10.316C13.3583 10.5328 13.7097 10.5328 13.9264 10.316C14.1431 10.0993 14.1431 9.74797 13.9264 9.53126L10.3948 5.9997Z" stroke-width="0.5"></path></svg></button></div> <!----> <!----> <!----> <!----> <!----> <!----></div> <!----> <!----> <!----> <!----> <!----> <!----> <!----> <!----> <!----> <!----> <!----> <!----></div></div></div><script class="">window.__NUXT__=(function(a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z,A,B,C,D,E,F,G,H,I,J,K,L,M,N){r.loading=a;r.skeleton=c;r.cursor=f;r.data=[];r.total=d;r.hasMore=c;return {layout:"default",data:[{}],fetch:{"data-v-0d14266a:0":{queryString:e,isShowUserDropdownList:a,isShowAddMoreList:a,isFocus:a,isPhoneMenuShow:a,visibleBadge:a,placeholder:e,hiddenProperty:"hidden",searchHistoryVisible:a,searchHistoryItems:[],tabBadge:b,isChangePlaceholder:c,showMallBridge:a,showAIProblemBridge:a,removeSearchInputKeyupListener:b,logoImg:"\u002F\u002Flf-web-assets.juejin.cn\u002Fobj\u002Fjuejin-web\u002Fxitu_juejin_web\u002Fe08da34488b114bd4c665ba2fa520a31.svg",rightHomeLogo:"\u002F\u002Flf-web-assets.juejin.cn\u002Fobj\u002Fjuejin-web\u002Fxitu_juejin_web\u002Fb48a296975c1bcd5efbbfe47c3141ca0.svg"},"data-v-3ea9885c:0":{hotTheme:[],count:d,loading:c}},error:b,state:{view:{activityIndex:{activityList:[],pageInfo:{hasNextPage:a,endCursor:e},afterPosition:e,activityListIsLoading:c,activityListIsError:a,userActivityList:[],placeholder:e,actionType:{FETCH:"@\u002Fview\u002Factivity-index\u002FFETCH",FETCH_RECOMMEND_LIST:"@\u002Fview\u002Factivity-index\u002FFETCH_RECOMMEND_LIST",RESET_ACTIVITY_LIST:"@\u002Fview\u002Factivity-index\u002FRESET_ACTIVITY_LIST",FETCH_USER_ACTIVITY_LIST:"@\u002Fview\u002Factivity-index\u002FFETCH_USER_ACTIVITY_LIST",FETCH_NEW_COUNT:"@\u002Fview\u002Factivity-index\u002FFETCH_NEW_COUNT",DELETE_ACTIVITY:"@\u002Fview\u002Factivity-index\u002FDELETE_ACTIVITY",TOGGLE_FOLLOW_USER:"@\u002Fview\u002Factivity-index\u002FTOGGLE_FOLLOW_USER",FETCH_ENTRY_COMMENT_LIST:"@\u002Fview\u002Factivity-index\u002FFETCH_ENTRY_COMMENT_LIST",UPDATE_LIST_LOADING:"@\u002Fview\u002Factivity-index\u002FUPDATE_LIST_LOADING",RESET:"@\u002Fview\u002Factivity-index\u002FRESET"},hotList:{list:[],after:e,loading:a,hasNextPage:a,actionType:{UPDATE_STATE:"@\u002Fview\u002Factivity-index\u002Fhot-list\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Factivity-index\u002Fhot-list\u002FFETCH_MORE",FETCH:"@\u002Fview\u002Factivity-index\u002Fhot-list\u002FFETCH",RESET:"@\u002Fview\u002Factivity-index\u002Fhot-list\u002FRESET"}},sidebar:{bannerList:[],actionType:{RESET:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002FRESET",UPDATE_STATE:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002FUPDATE_STATE",FETCH_BANNER:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002FFETCH_BANNER"},recommend:{pageSize:g,page:d,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Frecommend-topic-list\u002FUPDATE",FETCH:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Frecommend-topic-list\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Frecommend-topic-list\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Frecommend-topic-list\u002FFETCH_MORE",RESET:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Frecommend-topic-list\u002FRESET"},after:d},followed:{pageSize:g,page:d,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Ffollowed-topic-list\u002FUPDATE",FETCH:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Ffollowed-topic-list\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Ffollowed-topic-list\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Ffollowed-topic-list\u002FFETCH_MORE",RESET:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Ffollowed-topic-list\u002FRESET"},after:d},recommendPin:{list:[],after:e,loading:a,hasNextPage:c,actionType:{UPDATE_STATE:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Frecommend-pin-list\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Frecommend-pin-list\u002FFETCH_MORE",FETCH:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Frecommend-pin-list\u002FFETCH",RESET:"@\u002Fview\u002Factivity-index\u002Fsidebar\u002Frecommend-pin-list\u002FRESET"}}},topicPinList:{pageSize:g,page:h,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Factivity-index\u002Ftopic-pin-list\u002FUPDATE",FETCH:"@\u002Fview\u002Factivity-index\u002Ftopic-pin-list\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Factivity-index\u002Ftopic-pin-list\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Factivity-index\u002Ftopic-pin-list\u002FFETCH_MORE",RESET:"@\u002Fview\u002Factivity-index\u002Ftopic-pin-list\u002FRESET"},topicId:e,navList:[{type:j,name:j,title:"推荐 ",id:j},{type:n,name:n,title:"热门 ",id:n},{type:m,name:m,title:"关注 ",id:m},{type:k,name:"opensource",title:"开源推荐 ",id:"5c09ea2b092dcb42c740fe73"},{type:k,name:"recruitment",title:"内推招聘",id:"5abb61e1092dcb4620ca3322"},{type:k,name:"dating",title:"掘金相亲",id:"5abcaa67092dcb4620ca335c"},{type:k,name:"slacking",title:"上班摸鱼",id:"5c106be9092dcb2cc5de7257"},{type:k,name:"app",title:"应用安利",id:"5b514af1092dcb61bd72800d"},{type:k,name:"tool",title:"开发工具",id:"5abb67d2092dcb4620ca3324"},{type:k,name:"news",title:"New资讯",id:"5c46a17f092dcb4737217152"}],sortType:p}},search:{search_result_from:d,query:e,list:[],linkList:[],loading:a,skeleton:c,actionType:{FETCH:"@\u002Fview\u002Fsearch\u002FFETCH",FETCH_MORE:"@\u002Fview\u002Fsearch\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fsearch\u002FRESET"}},columnIndex:{list:{pageSize:g,page:h,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002FcolumnIndex\u002Flist\u002FUPDATE",FETCH:"@\u002Fview\u002FcolumnIndex\u002Flist\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002FcolumnIndex\u002Flist\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002FcolumnIndex\u002Flist\u002FFETCH_MORE",RESET:"@\u002Fview\u002FcolumnIndex\u002Flist\u002FRESET"},sort:o,category:"all"},hotList:{pageSize:g,page:h,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002FcolumnIndex\u002FhotList\u002FUPDATE",FETCH:"@\u002Fview\u002FcolumnIndex\u002FhotList\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002FcolumnIndex\u002FhotList\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002FcolumnIndex\u002FhotList\u002FFETCH_MORE",RESET:"@\u002Fview\u002FcolumnIndex\u002FhotList\u002FRESET"}}},timelineIndex:{tdkTemplates:[],categoryNavList:[{name:m,title:"关注",alias:m,countKeyIfNew:8},{name:j,title:"综合",alias:j},{category_id:"6809637769959178254",category_name:"后端",category_url:"backend",rank:h,back_ground:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002Ffb3b208d06e6fe32.png",icon:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002Fa2ec01b816abd4c5.png",ctime:1457483880,mtime:1432503193,show_type:3,item_type:i,promote_tag_cap:4,promote_priority:h,id:"6809637769959178254",name:"后端",title:"后端",alias:"backend"},{category_id:"6809637767543259144",category_name:"前端",category_url:"frontend",rank:i,back_ground:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002F8c95587526f346c0.png",icon:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002F1c40f5eaba561e32.png",ctime:1457483942,mtime:1432503190,show_type:3,item_type:i,promote_tag_cap:4,promote_priority:i,id:"6809637767543259144",name:"前端",title:"前端",alias:"frontend"},{category_id:"6809635626879549454",category_name:"Android",category_url:"android",rank:3,back_ground:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002Fec8d337c485c4db2.png",icon:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002F225aafca3a440e5d.png",ctime:1461266353,mtime:1432503184,show_type:3,item_type:i,promote_tag_cap:4,promote_priority:3,id:"6809635626879549454",name:"Android",title:"Android",alias:"android"},{category_id:"6809635626661445640",category_name:"iOS",category_url:"ios",rank:4,back_ground:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002F34589746327a360a.png",icon:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002F4a218bdf1f6969fd.png",ctime:1461266350,mtime:1432503174,show_type:3,item_type:i,promote_tag_cap:4,promote_priority:4,id:"6809635626661445640",name:"iOS",title:"iOS",alias:"ios"},{category_id:"6809637773935378440",category_name:"人工智能",category_url:"ai",rank:5,back_ground:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002Ff7cecf8806e8621ef35e.jpg",icon:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002F9b525117507d7a76c4ac.png",ctime:1500876664,mtime:1500876667,show_type:3,item_type:i,promote_tag_cap:4,promote_priority:5,id:"6809637773935378440",name:"人工智能",title:"人工智能",alias:"ai"},{category_id:"6809637771511070734",category_name:"开发工具",category_url:"freebie",rank:6,back_ground:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002F412957a61f414c0b.png",icon:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002Feb20ab1334d9abea.png",ctime:1457483920,mtime:1432503202,show_type:3,item_type:i,promote_tag_cap:4,promote_priority:6,id:"6809637771511070734",name:"开发工具",title:"开发工具",alias:"freebie"},{category_id:"6809637776263217160",category_name:"代码人生",category_url:"career",rank:7,back_ground:e,icon:e,ctime:1553759544,mtime:1553759548,show_type:3,item_type:i,promote_tag_cap:4,promote_priority:7,id:"6809637776263217160",name:"代码人生",title:"代码人生",alias:"career"},{category_id:"6809637772874219534",category_name:"阅读",category_url:"article",rank:8,back_ground:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002F228be0376b22924b.png",icon:"https:\u002F\u002Flc-mhke0kuv.cn-n1.lcfile.com\u002F20f56d7df9f97d1d.png",ctime:1457483895,mtime:1432503208,show_type:3,item_type:i,promote_tag_cap:4,promote_priority:8,id:"6809637772874219534",name:"阅读",title:"阅读",alias:"article"},{name:t,title:"排行榜",alias:t,target:"_blank"}],tagNavList:[],splitTagList:[],timelineAdList:[],list:[],sort:p,category:j,categoryId:e,tagId:e,tag:"全部",actionType:{FETCH_TIMELINE_LIST:"@\u002Fview\u002FtimelineIndex\u002FFETCH_TIMELINE_LIST",FETCH_CATEGORY_LIST:"@\u002Fview\u002FtimelineIndex\u002FFETCH_CATEGORY_LIST",FETCH_TAG_LIST:"@\u002Fview\u002FtimelineIndex\u002FFETCH_TAG_LIST",DELETE_ENTRY:"@\u002Fview\u002FtimelineIndex\u002FDELETE_ENTRY",DELETE_USER_ENTRIES:"@\u002Fview\u002FtimelineIndex\u002FDELETE_USER_ENTRIES",DELETE_TAG_ENTRIES:"@\u002Fview\u002FtimelineIndex\u002FDELETE_TAG_ENTRIES",FETCH_MORE:"@\u002Fview\u002FtimelineIndex\u002FFETCH_MORE",FETCH:"@\u002Fview\u002FtimelineIndex\u002FFETCH",RESET:"@\u002Fview\u002FtimelineIndex\u002FRESET"},serverRenderTimelineList:a,timelineList:{list:[],cursor:f,skeleton:c,loading:a,hasMore:c,categoryId:e,tagId:e,sort:e,actionType:{UPDATE_STATE:"timeline-list\u002FUPDATE_STATE",FETCH_MORE:"timeline-list\u002FFETCH_MORE",FETCH:"timeline-list\u002FFETCH",RESET:"timeline-list\u002FRESET"}},recommendList:{list:[],cursor:f,sort:e,loading:a,skeleton:c,hasMore:c,actionType:{UPDATE_STATE:"recommend-list\u002FUPDATE_STATE",FETCH_MORE:"recommend-list\u002FFETCH_MORE",FETCH:"recommend-list\u002FFETCH",RESET:"recommend-list\u002FRESET"}},followingList:{list:[],cursor:f,skeleton:c,loading:a,hasMore:c,actionType:{UPDATE_STATE:"following-list\u002FUPDATE_STATE",FETCH_MORE:"following-list\u002FFETCH_MORE",FETCH:"following-list\u002FFETCH",RESET:"following-list\u002FRESET"}}},subscribe:{subscribed:{list:[],cursor:f,skeleton:c,loading:a,hasMore:a,actionType:{UPDATE_STATE:"view\u002Fsubscribe\u002Fsubscribed\u002Flist\u002FUPDATE_STATE",FETCH_MORE:"view\u002Fsubscribe\u002Fsubscribed\u002Flist\u002FFETCH_MORE",FETCH:"view\u002Fsubscribe\u002Fsubscribed\u002Flist\u002FFETCH",RESET:"view\u002Fsubscribe\u002Fsubscribed\u002Flist\u002FRESET"}},all:{list:[],cursor:f,loading:a,skeleton:c,hasMore:a,linkList:e,actionType:{UPDATE_STATE:"view\u002Fsubscribe\u002Fall\u002Flist\u002FUPDATE_STATE",FETCH_MORE:"view\u002Fsubscribe\u002Fall\u002Flist\u002FFETCH_MORE",FETCH:"view\u002Fsubscribe\u002Fall\u002Flist\u002FFETCH",RESET:"view\u002Fsubscribe\u002Fall\u002Flist\u002FRESET"}}},entryPublic:{entry:{user:{}},relatedEntryList:[],relatedCollectionList:[],actionType:{FETCH:"@\u002Fview\u002FentryPublic\u002FFETCH",RESET:"@\u002Fview\u002FentryPublic\u002FRESET"}},user:{user:{},serverRendered:a,userAnnuals:[],actionType:{FETCH:"@\u002Fview\u002Fuser\u002FFETCH",RESET:"@\u002Fview\u002Fuser\u002FRESET",UPDATE:"@\u002Fview\u002Fuser\u002FUPDATE",FETCH_ANNUALS:"@\u002Fview\u002Fuser\u002FFETCH_ANNUALS"},detailList:{actionType:{RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FRESET"},likeList:{list:[],cursor:f,hasMore:a,loading:a,skeleton:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FlikePostList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FlikePostList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FlikePostList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FlikePostList\u002FRESET"}},postList:{list:[],hasMore:a,skeleton:a,loading:a,sort:o,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FpostList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FpostList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FpostList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FpostList\u002FRESET"}},searchList:{list:[],hasMore:a,skeleton:a,loading:a,key_word:e,search_type:d,cursor:f,isPostSearch:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FsearchList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FsearchList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FsearchList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FsearchList\u002FRESET"}},tagList:{list:[],loading:a,skeleton:a,hasMore:a,cursor:f,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FtagList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FtagList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FtagList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FtagList\u002FRESET"}},collectionList:{list:[],userId:e,skeleton:a,hasMore:a,cursor:f,type:u,loading:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FcollectionList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FcollectionList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FcollectionList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FcollectionList\u002FRESET",TOGGLE_FOLLOW_COLLECTION:"@\u002Fview\u002Fuser\u002FdetailList\u002FcollectionList\u002FTOGGLE_FOLLOW_COLLECTION",FOLLOW_COLLECTION:"@\u002Fview\u002Fuser\u002FdetailList\u002FcollectionList\u002FFOLLOW_COLLECTION",UNFOLLOW_COLLECTION:"@\u002Fview\u002Fuser\u002FdetailList\u002FcollectionList\u002FUNFOLLOW_COLLECTION",DELELTE_COLLECTION:"@\u002Fview\u002Fuser\u002FdetailList\u002FcollectionList\u002FDELELTE_COLLECTION",ADD_COLLECTION:"@\u002Fview\u002Fuser\u002FdetailList\u002FcollectionList\u002FADD_COLLECTION",EDIT_COLLECTION:"@\u002Fview\u002Fuser\u002FdetailList\u002FcollectionList\u002FEDIT_COLLECTION"}},followerList:{list:[],cursor:f,hasMore:a,loading:a,skeleton:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowerList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowerList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowerList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowerList\u002FRESET"}},followingList:{list:[],cursor:f,hasMore:a,skeleton:a,loading:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowingList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowingList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowingList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowingList\u002FRESET"}},followingTeamsList:{list:[],cursor:f,hasMore:a,skeleton:a,loading:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowingTeamsList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowingTeamsList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowingTeamsList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FfollowingTeamsList\u002FRESET"}},activityList:{list:[],cursor:f,hasMore:a,loading:a,skeleton:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FactivityList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FactivityList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FactivityList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FactivityList\u002FRESET"}},bookList:{list:[],cursor:f,skeleton:a,hasMore:a,loading:a,type:"wrote",actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FbookList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FbookList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FbookList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FbookList\u002FRESET"}},pinList:{list:[],hasMore:a,loading:a,skeleton:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FpinList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FpinList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FpinList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FpinList\u002FRESET"}},courseList:{list:[],hasMore:a,loading:a,skeleton:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FcourseList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FcourseList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FcourseList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FcourseList\u002FRESET"}},pinPraisedList:{list:[],cursor:f,hasMore:a,loading:a,skeleton:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FpinPraisedList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FpinPraisedList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FpinPraisedList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FpinPraisedList\u002FRESET"}},eventList:{list:[],cursor:f,hasMore:a,loading:a,skeleton:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FeventList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FeventList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FeventList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FeventList\u002FRESET"}},selfColumnList:{list:[],hasMore:a,skeleton:a,loading:a,cursor:f,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FcolumnList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FcolumnList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FcolumnList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FcolumnList\u002FRESET"}},columnFollowedList:{list:[],hasMore:a,skeleton:a,loading:a,cursor:f,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FcolumnFollowedList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FcolumnFollowedList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FcolumnFollowedList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FcolumnFollowedList\u002FRESET",FILTER:"@\u002Fview\u002Fuser\u002FdetailList\u002FcolumnFollowedList\u002FFILTER"}},realtimes:{list:[],cursor:f,hasMore:a,loading:a,skeleton:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002Frealtimes\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002Frealtimes\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002Frealtimes\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002Frealtimes\u002FRESET",DELETE:"@\u002Fview\u002Fuser\u002FdetailList\u002Frealtimes\u002FDELETE"}},realtimeliked:{list:[],cursor:f,hasMore:a,loading:a,skeleton:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002Frealtimeliked\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002Frealtimeliked\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002Frealtimeliked\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002Frealtimeliked\u002FRESET",DELETE:"@\u002Fview\u002Fuser\u002FdetailList\u002Frealtimeliked\u002FDELETE"}},robotList:{list:[],cursor:f,type:u,hasMore:a,skeleton:a,loading:a,actionType:{FETCH:"@\u002Fview\u002Fuser\u002FdetailList\u002FrobotList\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fuser\u002FdetailList\u002FrobotList\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fuser\u002FdetailList\u002FrobotList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fuser\u002FdetailList\u002FrobotList\u002FRESET"}}}},tag:{tag:{},actionType:{FETCH:"@\u002Fview\u002Ftag\u002FFETCH",FETCH_LIST:"@\u002Fview\u002Ftag\u002FFETCH_LIST",RESET:"@\u002Fview\u002Ftag\u002FRESET"},list:{list:[],cursor:f,loading:a,skeleton:a,hasMore:a,actionType:{UPDATE_STATE:"@\u002Fview\u002Ftag\u002Flist\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Ftag\u002Flist\u002FFETCH_MORE",FETCH:"@\u002Fview\u002Ftag\u002Flist\u002FFETCH",RESET:"@\u002Fview\u002Ftag\u002Flist\u002FRESET"}}},notification:{user:{actionType:{RESET:"@\u002Fview\u002Fnotification\u002Fuser\u002FRESET"},listState:{list:[],cursor:f,hasMore:a,isLoading:a,messageType:3,msgTotal:d,msgSubMap:{"1":d,"2":d,"3":d,"4":d,"7":d}},list:{pageSize:g,page:h,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Fnotification\u002Fuser\u002Flist\u002FUPDATE",FETCH:"@\u002Fview\u002Fnotification\u002Fuser\u002Flist\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Fnotification\u002Fuser\u002Flist\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Fnotification\u002Fuser\u002Flist\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fnotification\u002Fuser\u002Flist\u002FRESET"}}},system:{actionType:{RESET:"@\u002Fview\u002Fnotification\u002Fsystem\u002FRESET"},list:{pageSize:g,page:h,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Fnotification\u002Fsystem\u002Flist\u002FUPDATE",FETCH:"@\u002Fview\u002Fnotification\u002Fsystem\u002Flist\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Fnotification\u002Fsystem\u002Flist\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Fnotification\u002Fsystem\u002Flist\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fnotification\u002Fsystem\u002Flist\u002FRESET"}}}},column:{serverRenderList:a,column:{},entry:{},entryView:{},author:{},adEntryList:[],relatedEntryList:[],selectedList:[],linkVotingList:[],userAnnuals:[],columnList:[],hitArticleCache:a,authorCard:{},relatedLoaded:a,dynamicDataReady:a,followAuthorPopupTime:d,followAuthorPopupType:d,authorBlockVisible:d,compVisible:{},version:q,actionType:{FETCH:"view\u002Fcolumn\u002FFETCH",FETCH_RELATED:"view\u002Fcolumn\u002FFETCH_RELATED",FETCH_RECOMMEND:"view\u002Fcolumn\u002FFETCH_RECOMMEND",FETCH_SELECTED:"view\u002Fcolumn\u002FFETCH_SELECTED",FETCH_ADDITIONAL:"view\u002Fcolumn\u002FFETCH_ADDITIONAL",FETCH_SIDEBAR_ADENTRY:"view\u002Fcolumn\u002FFETCH_SIDEBAR_ADENTRY",FETCH_AUTHOR_EXTRA:"view\u002Fcolumn\u002FFETCH_AUTHOR_EXTRA",MD_FALLBACK_RENDER:"view\u002Fcolumn\u002FMD_FALLBACK_RENDER",RESET:"view\u002Fcolumn\u002FRESET"},recommendedArticleList:{list:[],cursor:f,loading:a,skeleton:a,hasMore:a,articleId:e,actionType:{UPDATE_STATE:"view\u002Fcolumn\u002Frecommend-List\u002FUPDATE_STATE",FETCH_MORE:"view\u002Fcolumn\u002Frecommend-List\u002FFETCH_MORE",FETCH:"view\u002Fcolumn\u002Frecommend-List\u002FFETCH",RESET:"view\u002Fcolumn\u002Frecommend-List\u002FRESET"}}},collection:{collection:{author:{}},actionType:{FETCH:"@\u002Fview\u002Fcollection\u002FFETCH",REFRESH:"@\u002Fview\u002Fcollection\u002FREFRESH",RESET:"@\u002Fview\u002Fcollection\u002FRESET"},list:{pageSize:g,page:h,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Fcollection\u002Flist\u002FUPDATE",FETCH:"@\u002Fview\u002Fcollection\u002Flist\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Fcollection\u002Flist\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Fcollection\u002Flist\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fcollection\u002Flist\u002FRESET"},id:e,sort:o}},gettingStarted:{category:{},actionType:{UPDATE_STATE:"@\u002Fview\u002FgettingStarted\u002FUPDATE_STATE",FOLLOW:"@\u002Fview\u002FgettingStarted\u002FFOLLOW",RESET:"@\u002Fview\u002FgettingStarted\u002FRESET",UPDATE_CATEGORY:"@\u002Fview\u002FgettingStarted\u002FUPDATE_CATEGORY"}},pin:{pin:{user:{},imageUrlList:[]},pinList:[],actionType:{FETCH:"@\u002Fview\u002Fpin\u002FFETCH",RESET:"@\u002Fview\u002Fpin\u002FRESET"},sidebar:{list:[],after:e,loading:a,isRecommend:a,hasNextPage:c,actionType:{UPDATE_STATE:"@\u002Fview\u002Fpin\u002Fsidebar\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fpin\u002Fsidebar\u002FFETCH_MORE",FETCH:"@\u002Fview\u002Fpin\u002Fsidebar\u002FFETCH",RESET:"@\u002Fview\u002Fpin\u002Fsidebar\u002FRESET"}},commentList:{pageSize:g,page:h,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Fpin\u002FcommentList\u002FUPDATE",FETCH:"@\u002Fview\u002Fpin\u002FcommentList\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Fpin\u002FcommentList\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Fpin\u002FcommentList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fpin\u002FcommentList\u002FRESET"},pinId:b},subCommentList:{pageSize:g,page:h,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Fpin\u002FsubCommentList\u002FUPDATE",FETCH:"@\u002Fview\u002Fpin\u002FsubCommentList\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Fpin\u002FsubCommentList\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Fpin\u002FsubCommentList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fpin\u002FsubCommentList\u002FRESET"},commentId:b}},topic:{topic:e,followedTopicList:[],actionType:{FETCH:"@\u002Fview\u002Ftopic\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Ftopic\u002FUPDATE_STATE",RESET:"@\u002Fview\u002Ftopic\u002FRESET"},allTopicList:{pageSize:v,page:d,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Ftopic\u002FallTopicList\u002FUPDATE",FETCH:"@\u002Fview\u002Ftopic\u002FallTopicList\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Ftopic\u002FallTopicList\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Ftopic\u002FallTopicList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Ftopic\u002FallTopicList\u002FRESET"},sortType:n},pinlist:{pageSize:g,page:h,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Ftopic\u002FpinList\u002FUPDATE",FETCH:"@\u002Fview\u002Ftopic\u002FpinList\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Ftopic\u002FpinList\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Ftopic\u002FpinList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Ftopic\u002FpinList\u002FRESET"},sortType:p},sidebar:{actionType:{RESET:"@\u002Fview\u002Ftopic\u002Fsidebar\u002FRESET",UPDATE_STATE:"@\u002Fview\u002Ftopic\u002Fsidebar\u002FUPDATE_STATE"},attender:{pageSize:g,page:h,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Ftopic\u002Fsidebar\u002Fattender\u002FUPDATE",FETCH:"@\u002Fview\u002Ftopic\u002Fsidebar\u002Fattender\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Ftopic\u002Fsidebar\u002Fattender\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Ftopic\u002Fsidebar\u002Fattender\u002FFETCH_MORE",RESET:"@\u002Fview\u002Ftopic\u002Fsidebar\u002Fattender\u002FRESET"},topicId:b}},followedList:{pageSize:v,page:d,total:d,pointer:b,lastPointer:b,list:[],loading:a,error:b,canPrev:c,canNext:c,linkList:[],lastFetchOnServer:a,actionType:{UPDATE:"@\u002Fview\u002Ftopic\u002FfollowedList\u002FUPDATE",FETCH:"@\u002Fview\u002Ftopic\u002FfollowedList\u002FFETCH",FORCE_FETCH:"@\u002Fview\u002Ftopic\u002FfollowedList\u002FFORCE_FETCH",FETCH_MORE:"@\u002Fview\u002Ftopic\u002FfollowedList\u002FFETCH_MORE",RESET:"@\u002Fview\u002Ftopic\u002FfollowedList\u002FRESET"},after:d}},recommendationIndex:{actionType:{FETCH_USER:"@\u002Fview\u002Frecommendation\u002FFETCH_USER",FETCH_MORE:"@\u002Fview\u002Frecommendation\u002FFETCH_MORE",RESET:"@\u002Fview\u002Frecommendation\u002FRESET",FETCH:"@\u002Fview\u002Frecommendation\u002FFETCH"},cursor:e,hasMore:e,userList:[],loading:a,skeleton:c,category:j,categoryNavList:[],serverRenderUserList:a},event:{event:{},loading:a,user:{},actionType:{FETCH:"view\u002Fevent\u002FFETCH",RESET:"view\u002Fevent\u002FRESET"}},coursesIndex:{loading:a,list:[],sort:"online",actionType:{FETCH:"view\u002Fcourses\u002FFETCH",RESET:"view\u002Fcourses\u002FRESET",FETCH_MORE:"view\u002Fcourses\u002FFETCH_MORE"}},team:{team:{},loading:c,actionType:{FETCH:"@\u002Fview\u002Fteam\u002FFETCH",RESET:"@\u002Fview\u002Fteam\u002FRESET",UPDATE:"@\u002Fview\u002Fteam\u002FUPDATE",FOLLOW:"@\u002Fview\u002Fteam\u002FFOLLOW"},detailList:{actionType:{RESET:"@\u002Fview\u002Fteam\u002FdetailList\u002FRESET"},posts:{list:[],hasMore:a,skeleton:a,loading:a,sort:o,actionType:{FETCH:"@\u002Fview\u002Fteam\u002FdetailList\u002Fposts\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fteam\u002FdetailList\u002Fposts\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fteam\u002FdetailList\u002Fposts\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fteam\u002FdetailList\u002Fposts\u002FRESET"}},pins:{list:[],hasMore:a,loading:a,skeleton:c,actionType:{FETCH:"@\u002Fview\u002Fteam\u002FdetailList\u002Fpins\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fteam\u002FdetailList\u002Fpins\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fteam\u002FdetailList\u002Fpins\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fteam\u002FdetailList\u002Fpins\u002FRESET"}},hire:{list:[],hasMore:a,cursor:f,loading:a,skeleton:c,actionType:{FETCH:"@\u002Fview\u002Fteam\u002FdetailList\u002Fhire\u002FFETCH",UPDATE_STATE:"@\u002Fview\u002Fteam\u002FdetailList\u002Fhire\u002FUPDATE_STATE",FETCH_MORE:"@\u002Fview\u002Fteam\u002FdetailList\u002Fhire\u002FFETCH_MORE",RESET:"@\u002Fview\u002Fteam\u002FdetailList\u002Fhire\u002FRESET"}}}},couponList:{list:{"0":r,"1":r,"2":r},showTooltip:a},payment:{selectedDiscount:{},bookletDetail:{},coupons:{availables:[],unavailables:[]},discountList:[]},activityVip:{selectedVipSku:{}}},component:{indexAside:{bannerList:[],userList:[],botList:[],botCursor:e,actionType:{FETCH_BANNER:"@\u002Fcomponent\u002Faside\u002FFETCH_BANNER",FETCH_USER:"@\u002Fcomponent\u002Faside\u002FFETCH_USER",CLOSE_BANNER:"@\u002Fcomponent\u002Faside\u002FCLOSE_BANNER",FETCH_BOT:"@\u002Fcomponent\u002Faside\u002FFETCH_BOT"}}},dislike:{whiteList:["1398234521548542",w,x,y,z,A,B],officialList:[w,x,"3984285868490807",y,"3562073405009031",z,"4433674252325966","53218623894222","2110693287406632","2498524693925623","430664288836334",A,B,"2832783991648407","3386151545092589"]},ore:{oreCount:d},avatarMenuInfo:{user_basic:{},user_counter:{},user_growth_info:{}},common:{theme:"light",isFollowSystem:a},env:{ua:"Mozilla\u002F5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit\u002F537.36 (KHTML, like Gecko) Chrome\u002F140.0.0.0 Safari\u002F537.36",serverEnv:"production",logId:"20251013111936CA54CB7A1CC3B8D71AF5"},auth:{user:b,clientId:e,token:e,qrCode:b,qrCodeStatus:b,qrCodeToken:b,userInitiated:c,loginTeaParams:q},tag:{subscribedTagList:[]},entry:{isLikeLoading:a},collection:{},comment:{},bookComment:{},repoComment:{},category:{list:[]},user:{subscribedTagList:[]},notification:{unreadCount:{user:d,system:d,total:d}},error:{location:b,errorView:b,statusCode:200,needRiskModal:a,riskAppealUrl:e},abTest:{info:{}},suspensionPanel:{needSuspension:c},pinComment:{},pin:{deleteDialogVisible:a,reportDialogVisible:a,targetPin:b,isOnFocus:a},topic:{visible:a},activity:{"2020":{},offer:{is_show:d,start_time:d},voteData:{err_no:d,err_msg:"success",data:{face:{title:"2023年度报告",activity_id:"20240129",start_time:1706457600,end_time:1708617599,status:i,image:"https:\u002F\u002Fp1-juejin.byteimg.com\u002Ftos-cn-i-k3u1fbpfcp\u002F5bbc3ebdf56a4724ab0c920ea20197ca~tplv-k3u1fbpfcp-image.image#?w=900&h=948&s=919974&e=png&a=1&b=0b60df",close_image:l,url:"https:\u002F\u002Fjuejin.cn\u002Freport2023\u002F?utm_campaign=report2023&utm_medium=face&utm_source=app",is_show:d},top:{title:"玩游戏抽PS5！",activity_id:"2310251",start_time:1697299200,end_time:1698595200,status:i,image:"https:\u002F\u002Fp9-juejin.byteimg.com\u002Ftos-cn-i-k3u1fbpfcp\u002F8ef5f1b83ea949709e1abfa9fde78d7e~tplv-k3u1fbpfcp-jj:0:0:0:0:q75.image#?w=512&h=512&s=69988&e=png&a=1&b=db69f8",close_image:l,url:"https:\u002F\u002Fjuejin.cn\u002Fmagic\u002Feco\u002Fruntime\u002Frelease\u002F6522830e395b6405e161dea4?appType=juejin&magic_page_no=1&magic_source=1025sydb",is_show:d},web_top:{title:C,activity_id:D,start_time:E,end_time:F,status:i,image:G,close_image:l,url:H,is_show:d},plugin_top:{title:C,activity_id:D,start_time:E,end_time:F,status:i,image:G,close_image:l,url:H,is_show:d},search_top:{title:"2024人气创作者榜单！",activity_id:"20241219002",start_time:I,end_time:J,status:i,image:K,close_image:l,url:L,is_show:d},web_search:{title:"2024人气创作者榜单",activity_id:"20241219003",start_time:I,end_time:J,status:i,image:K,close_image:l,url:L,is_show:d},jcode_top:{title:"2023人气创作者榜单",activity_id:"20231218",start_time:1702828800,end_time:1703865599,status:i,image:"https:\u002F\u002Fp9-juejin.byteimg.com\u002Ftos-cn-i-k3u1fbpfcp\u002Fdcd641156beb440fa6a7d4ef3d1309e4~tplv-k3u1fbpfcp-zoom-1.image",close_image:l,url:"https:\u002F\u002Factivity.juejin.cn\u002Frank\u002F2023\u002F?utm_campaign=annual_2023&utm_medium=web_entrance&utm_source=code_nav",is_show:d},offer:{title:e,activity_id:"2020",start_time:1617638400,end_time:1618934400,status:i,image:"https:\u002F\u002Fp9-juejin.byteimg.com\u002Ftos-cn-i-k3u1fbpfcp\u002F2879410508de459c91ae8b7509ca75f8~tplv-k3u1fbpfcp-zoom-1.image",close_image:"https:\u002F\u002Fp9-juejin.byteimg.com\u002Ftos-cn-i-k3u1fbpfcp\u002Fa38d640009e14c87a7d29cd95dee27dd~tplv-k3u1fbpfcp-zoom-1.image",url:"https:\u002F\u002Fjuejin-activity.bytedance.net\u002Frank",is_show:d}}}},header:{leadStep:d,isPopupZlink:a},tcc:{tccConfig:b},adAssets:{adverts:[]},route:{name:M,path:s,hash:e,query:{},params:{category:"ai",tag:q},fullPath:s,meta:{isAvailableDarkMode:c},from:{name:b,path:N,hash:e,query:{},params:{},fullPath:N,meta:{}}}},serverRendered:c,routePath:s,config:{API_HOST:"api.juejin.cn",CAPTCHA_HOST:"verify.snssdk.com",PLATFORM_APPID:{wechat:1277,weibo:1276,github:1045,wechatApp:1070},SCM_VERSION:"1.0.0.628",REGISTERED_ROUTES:M},globalRefs:{}}}(false,null,true,0,"","0",20,1,2,"recommended","topic","https:\u002F\u002Fp3-juejin.byteimg.com\u002Ftos-cn-i-k3u1fbpfcp\u002F882fc263e36347ffbf6d598de520870e~tplv-k3u1fbpfcp-image.image","following","hot","newest","popular",void 0,{},"\u002Fai","rank","created",100,"1556564194374926","940837680722589","2780007432717400","1204720443866983","852876722177533","3227821828225517","做任务得积分，兑华为 MatePad、雷蛇机械键盘、京东卡、热门会员卡等好礼","20250303",1740931200,1746028799,"https:\u002F\u002Fp3-piu.byteimg.com\u002Ftos-cn-i-8jisjyls3a\u002F0d1dfe0d00f148e0b1891243470195d1~tplv-8jisjyls3a-3:0:0:q75.png","https:\u002F\u002Fjuejin.cn\u002Floyalty-program-v1?utm_source=juejin&utm_medium=pofloyalty&utm_campaign=topbanner",1734278400,1735574399,"http:\u002F\u002Fp3-juejin.byteimg.com\u002Ftos-cn-i-k3u1fbpfcp\u002Fab24f8549ac8c5225a5ecfb9f04c3a24.png~tplv-k3u1fbpfcp-no-mark-v1:0:0:0:0.image","https:\u002F\u002Factivity.juejin.cn\u002Frank\u002F2024\u002F?utm_campaign=annual_2024&utm_medium=web_entrance&utm_source=search_bar","timelineIndex","\u002F"));</script><script src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/d18f829.js" defer="" class=""></script><script src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/0f99730.js" defer="" class=""></script><script src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/5621eec.js" defer="" class=""></script><script src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/c277702.js" defer="" class=""></script><script src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/fbde3a6.js" defer="" class=""></script><script src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/9150d90.js" defer="" class=""></script>
  

<link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/10.ed3cb2a.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/layouts/default.a1d6163.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/20.7c63bf5.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/33.1ea2750.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/41.4007e24.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/42.1bb0a10.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/46.71ee17b.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/15.26cc803.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/44.76340c8.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/32.9f6dadc.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/31.e76d9cc.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/45.9c56b68.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/34.f6517d5.css" rel="stylesheet" type="text/css" class=""><div data-v-41eefe39="" data-transfer="true" class="lead byte-modal v-transfer-dom"><div class="byte-modal__mask" style="z-index: 1001; display: none;"></div><div class="byte-modal__wrapper" style="z-index: 1001; display: none;"><div class="byte-modal__content" style="width: 500px;"><div class="byte-modal__header"><img data-v-41eefe39="" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/img/MaskGroup.13dfc4f.png" alt="" loading="lazy" class="header-bgc"> <span data-v-41eefe39="" class="header-title">选择你感兴趣的技术方向</span><span aria-label="Close" class="byte-modal__headerbtn"><i class="byte-icon byte-icon--close"><svg t="1561638608887" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="441911" xmlns:xlink="http://www.w3.org/1999/xlink"><path d="M512 448l288-288c6.4-6.4 19.2-6.4 32 0l25.6 32c6.4 6.4 6.4 19.2 0 32L569.6 505.6l288 288c6.4 6.4 6.4 19.2 0 32l-32 32c-6.4 6.4-19.2 6.4-32 0L512 569.6l-288 288c-6.4 6.4-19.2 6.4-32 0l-32-32c-6.4-6.4-6.4-19.2 0-32L448 505.6 160 224c-6.4-12.8-6.4-25.6 0-32l32-32c6.4-6.4 19.2-6.4 32 0L512 448z" p-id="441912"></path><path d="M512 448l288-288c6.4-6.4 19.2-6.4 32 0l25.6 32c6.4 6.4 6.4 19.2 0 32L569.6 505.6l288 288c6.4 6.4 6.4 19.2 0 32l-32 32c-6.4 6.4-19.2 6.4-32 0L512 569.6l-288 288c-6.4 6.4-19.2 6.4-32 0l-32-32c-6.4-6.4-6.4-19.2 0-32L448 505.6 160 224c-6.4-12.8-6.4-25.6 0-32l32-32c6.4-6.4 19.2-6.4 32 0L512 448z" p-id="441913"></path></svg></i></span></div><div class="byte-modal__body"> <div data-v-41eefe39="" class="classify-box"><div data-v-41eefe39="" class="technology-box"><div data-v-41eefe39="" class="wrap"><svg data-v-41eefe39="" width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg" class="left"><g data-v-41eefe39="" id="&amp;#230;&amp;#161;&amp;#136;&amp;#228;&amp;#190;&amp;#139;"><path data-v-41eefe39="" id="Subtract" fill-rule="evenodd" clip-rule="evenodd" d="M2 2.5C1.44772 2.5 1 2.94772 1 3.5V11.5C1 12.0523 1.44772 12.5 2 12.5H14C14.5523 12.5 15 12.0523 15 11.5V3.5C15 2.94772 14.5523 2.5 14 2.5H2ZM4.5 7.5C4.22386 7.5 4 7.72386 4 8V10C4 10.2761 4.22386 10.5 4.5 10.5H5C5.27614 10.5 5.5 10.2761 5.5 10V8C5.5 7.72386 5.27614 7.5 5 7.5H4.5ZM7 5.5C7 5.22386 7.22386 5 7.5 5H8C8.27614 5 8.5 5.22386 8.5 5.5V10C8.5 10.2761 8.27614 10.5 8 10.5H7.5C7.22386 10.5 7 10.2761 7 10V5.5ZM10.5 6.5C10.2239 6.5 10 6.72386 10 7V10C10 10.2761 10.2239 10.5 10.5 10.5H11C11.2761 10.5 11.5 10.2761 11.5 10V7C11.5 6.72386 11.2761 6.5 11 6.5H10.5Z" fill="#86909C"></path><rect data-v-41eefe39="" id="Rectangle 282" x="3" y="13.5" width="10" height="1.3" rx="0.5" fill="#86909C"></rect></g></svg> <div data-v-41eefe39="" class="right"><span data-v-41eefe39="" class="descrip">
              后端
            </span></div></div></div><div data-v-41eefe39="" class="technology-box"><div data-v-41eefe39="" class="wrap"><svg data-v-41eefe39="" width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg" class="left"><g data-v-41eefe39="" id="&amp;#230;&amp;#161;&amp;#136;&amp;#228;&amp;#190;&amp;#139;"><path data-v-41eefe39="" id="Subtract" fill-rule="evenodd" clip-rule="evenodd" d="M2 2.5C1.44772 2.5 1 2.94772 1 3.5V6.5H15V3.5C15 2.94772 14.5523 2.5 14 2.5H2ZM15 7.8H1V13.5C1 14.0523 1.44772 14.5 2 14.5H14C14.5523 14.5 15 14.0523 15 13.5V7.8ZM8.65811 8.52566C8.92009 8.61298 9.06167 8.89614 8.97434 9.15811L7.97434 12.1581C7.88702 12.4201 7.60386 12.5617 7.34189 12.4743C7.07991 12.387 6.93833 12.1039 7.02566 11.8419L8.02566 8.84189C8.11298 8.57991 8.39614 8.43833 8.65811 8.52566ZM3.5 5.5C3.77614 5.5 4 5.27614 4 5C4 4.72386 3.77614 4.5 3.5 4.5C3.22386 4.5 3 4.72386 3 5C3 5.27614 3.22386 5.5 3.5 5.5ZM5.5 5C5.5 5.27614 5.27614 5.5 5 5.5C4.72386 5.5 4.5 5.27614 4.5 5C4.5 4.72386 4.72386 4.5 5 4.5C5.27614 4.5 5.5 4.72386 5.5 5ZM6.5 5.5C6.77614 5.5 7 5.27614 7 5C7 4.72386 6.77614 4.5 6.5 4.5C6.22386 4.5 6 4.72386 6 5C6 5.27614 6.22386 5.5 6.5 5.5ZM6.44721 9.27639C6.57071 9.52338 6.4706 9.82372 6.22361 9.94721L5.11803 10.5L6.22361 11.0528C6.4706 11.1763 6.57071 11.4766 6.44721 11.7236C6.32372 11.9706 6.02338 12.0707 5.77639 11.9472L3.77639 10.9472C3.607 10.8625 3.5 10.6894 3.5 10.5C3.5 10.3106 3.607 10.1375 3.77639 10.0528L5.77639 9.05279C6.02338 8.92929 6.32372 9.0294 6.44721 9.27639ZM9.77639 9.94721C9.5294 9.82372 9.42929 9.52338 9.55279 9.27639C9.67628 9.0294 9.97662 8.92929 10.2236 9.05279L12.2236 10.0528C12.393 10.1375 12.5 10.3106 12.5 10.5C12.5 10.6894 12.393 10.8625 12.2236 10.9472L10.2236 11.9472C9.97662 12.0707 9.67628 11.9706 9.55279 11.7236C9.42929 11.4766 9.5294 11.1763 9.77639 11.0528L10.882 10.5L9.77639 9.94721Z" fill="#86909C"></path></g></svg> <div data-v-41eefe39="" class="right"><span data-v-41eefe39="" class="descrip">
              前端
            </span></div></div></div><div data-v-41eefe39="" class="technology-box"><div data-v-41eefe39="" class="wrap"><svg data-v-41eefe39="" width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg" class="left"><g data-v-41eefe39="" id="&amp;#230;&amp;#161;&amp;#136;&amp;#228;&amp;#190;&amp;#139;"><rect data-v-41eefe39="" id="Rectangle 287" x="5.7002" y="12.5" width="1.3" height="3" rx="0.5" fill="#86909C"></rect><rect data-v-41eefe39="" id="Rectangle 289" x="1" y="6.5" width="1.3" height="6" rx="0.5" fill="#86909C"></rect><rect data-v-41eefe39="" id="Rectangle 290" x="13.7002" y="6.5" width="1.3" height="6" rx="0.5" fill="#86909C"></rect><rect data-v-41eefe39="" id="Rectangle 288" x="9" y="12.5" width="1.3" height="3" rx="0.5" fill="#86909C"></rect><path data-v-41eefe39="" id="Subtract" fill-rule="evenodd" clip-rule="evenodd" d="M13 5.86364V12.5C13 13.0523 12.5523 13.5 12 13.5H4C3.44772 13.5 3 13.0523 3 12.5V5.86364V5.77273C3 5.74067 3.00151 5.70897 3.00446 5.67768C3.11608 3.35397 5.30996 1.5 8 1.5C10.69 1.5 12.8839 3.35397 12.9955 5.67768C12.9985 5.70897 13 5.74067 13 5.77273V5.86364ZM7 6.25C7 6.66421 6.66421 7 6.25 7C5.83579 7 5.5 6.66421 5.5 6.25C5.5 5.83579 5.83579 5.5 6.25 5.5C6.66421 5.5 7 5.83579 7 6.25ZM9.75 7C10.1642 7 10.5 6.66421 10.5 6.25C10.5 5.83579 10.1642 5.5 9.75 5.5C9.33579 5.5 9 5.83579 9 6.25C9 6.66421 9.33579 7 9.75 7Z" fill="#86909C"></path></g></svg> <div data-v-41eefe39="" class="right"><span data-v-41eefe39="" class="descrip">
              Android
            </span></div></div></div><div data-v-41eefe39="" class="technology-box"><div data-v-41eefe39="" class="wrap"><svg data-v-41eefe39="" width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg" class="left"><g data-v-41eefe39=""><g data-v-41eefe39="" id="pingguo-2 1"><path data-v-41eefe39="" id="Vector" d="M11.821 8.9388C11.8035 7.16562 13.267 6.31556 13.3322 6.27312C12.5097 5.06956 11.2287 4.90506 10.7724 4.88581C9.6821 4.77556 8.64523 5.52763 8.09179 5.52763C7.5401 5.52763 6.6861 4.902 5.78179 4.91863C4.59354 4.93613 3.49761 5.60944 2.88598 6.67387C1.65136 8.8163 2.56967 11.9899 3.77323 13.7277C4.36123 14.5782 5.06254 15.5332 5.98304 15.4991C6.86942 15.4637 7.20498 14.9255 8.27642 14.9255C9.34785 14.9255 9.64929 15.4991 10.5877 15.4816C11.5415 15.4637 12.1461 14.6149 12.7302 13.7618C13.4052 12.7752 13.6835 11.8197 13.6997 11.7707C13.6787 11.7611 11.8394 11.0567 11.821 8.9388ZM10.0584 3.73563C10.547 3.14281 10.8769 2.32031 10.7868 1.5C10.0829 1.52888 9.22973 1.969 8.72485 2.56006C8.2716 3.08463 7.87523 3.922 7.98154 4.72613C8.76729 4.78737 9.56923 4.32669 10.0584 3.73563Z" fill="#86909C"></path></g></g><defs data-v-41eefe39=""></defs></svg> <div data-v-41eefe39="" class="right"><span data-v-41eefe39="" class="descrip">
              iOS
            </span></div></div></div><div data-v-41eefe39="" class="technology-box"><div data-v-41eefe39="" class="wrap"><svg data-v-41eefe39="" width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg" class="left"><g data-v-41eefe39="" id="&amp;#230;&amp;#161;&amp;#136;&amp;#228;&amp;#190;&amp;#139;"><rect data-v-41eefe39="" id="Rectangle 289" x="1" y="8.5" width="1.3" height="5" rx="0.5" fill="#86909C"></rect><rect data-v-41eefe39="" id="Rectangle 292" x="14" y="8.5" width="1.3" height="5" rx="0.5" fill="#86909C"></rect><rect data-v-41eefe39="" id="Rectangle 293" x="7.5" y="4.5" width="1" height="3" rx="0.5" fill="#86909C"></rect><circle data-v-41eefe39="" id="Ellipse 25" cx="8" cy="2.5" r="1" fill="#86909C"></circle><path data-v-41eefe39="" id="Subtract" fill-rule="evenodd" clip-rule="evenodd" d="M3 7.5C3 6.94772 3.44772 6.5 4 6.5H12C12.5523 6.5 13 6.94772 13 7.5V14.5C13 15.0523 12.5523 15.5 12 15.5H4C3.44772 15.5 3 15.0523 3 14.5V7.5ZM7 11.25C7 11.6642 6.66421 12 6.25 12C5.83579 12 5.5 11.6642 5.5 11.25C5.5 10.8358 5.83579 10.5 6.25 10.5C6.66421 10.5 7 10.8358 7 11.25ZM9.75 12C10.1642 12 10.5 11.6642 10.5 11.25C10.5 10.8358 10.1642 10.5 9.75 10.5C9.33579 10.5 9 10.8358 9 11.25C9 11.6642 9.33579 12 9.75 12Z" fill="#86909C"></path></g></svg> <div data-v-41eefe39="" class="right"><span data-v-41eefe39="" class="descrip">
              人工智能
            </span></div></div></div><div data-v-41eefe39="" class="technology-box"><div data-v-41eefe39="" class="wrap"><svg data-v-41eefe39="" width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg" class="left"><g data-v-41eefe39="" id="&amp;#230;&amp;#161;&amp;#136;&amp;#228;&amp;#190;&amp;#139;"><g data-v-41eefe39="" id="kaifagongjuicon-hui 1"><path data-v-41eefe39="" id="Vector" d="M14.212 5.04986L13.497 5.76886C13.3158 5.95088 13.1005 6.09531 12.8633 6.19386C12.6261 6.29242 12.3718 6.34315 12.115 6.34315C11.8582 6.34315 11.6039 6.29242 11.3667 6.19386C11.1295 6.09531 10.9142 5.95088 10.733 5.76886C10.3664 5.39915 10.1606 4.89955 10.1606 4.37886C10.1606 3.85817 10.3664 3.35857 10.733 2.98886L11.448 2.26986C11.843 1.87286 11.579 1.40486 10.868 1.51686C10.028 1.64786 9.262 2.07586 8.709 2.72286C8.005 3.41786 7.682 4.66486 7.922 5.81786L1.927 11.8469C1.56096 12.2165 1.35562 12.7157 1.35562 13.2359C1.35562 13.7561 1.56096 14.2552 1.927 14.6249C2.10804 14.807 2.32329 14.9515 2.56038 15.0501C2.79747 15.1487 3.05172 15.1995 3.3085 15.1995C3.56528 15.1995 3.81953 15.1487 4.05662 15.0501C4.29371 14.9515 4.50896 14.807 4.69 14.6249L10.686 8.59486C11.2693 8.7189 11.8745 8.69473 12.446 8.52459C13.0176 8.35444 13.5375 8.04373 13.958 7.62086C14.5581 7.01861 14.9243 6.22244 14.991 5.37486C15.071 4.91886 14.607 4.65286 14.212 5.04986ZM3.768 13.6979C3.67659 13.7885 3.56041 13.85 3.4341 13.8747C3.30779 13.8994 3.17699 13.8861 3.05819 13.8366C2.93939 13.7871 2.8379 13.7036 2.76651 13.5965C2.69511 13.4894 2.65701 13.3636 2.657 13.2349C2.65647 13.0618 2.72462 12.8957 2.84649 12.7729C2.96836 12.6501 3.13399 12.5807 3.307 12.5799C3.487 12.5799 3.651 12.6529 3.768 12.7719C3.888 12.8889 3.96 13.0539 3.96 13.2349C3.9604 13.3209 3.94363 13.4062 3.91066 13.4857C3.87769 13.5652 3.82919 13.6373 3.768 13.6979ZM3.118 5.16786L5.377 7.43986L6.297 6.51286L4.04 4.24286L3.535 3.27086L1.92 2.11186L1 3.03986L2.151 4.66086L3.118 5.16786ZM10.672 9.98586C10.642 9.95526 10.6062 9.93095 10.5667 9.91436C10.5272 9.89776 10.4848 9.88921 10.442 9.88921C10.3992 9.88921 10.3568 9.89776 10.3173 9.91436C10.2778 9.93095 10.242 9.95526 10.212 9.98586L8.83 11.3759C8.79955 11.4062 8.7754 11.4423 8.75891 11.482C8.74243 11.5218 8.73395 11.5644 8.73395 11.6074C8.73395 11.6504 8.74243 11.693 8.75891 11.7327C8.7754 11.7724 8.79955 11.8085 8.83 11.8389L12.09 15.1169C12.2106 15.2383 12.3541 15.3348 12.5122 15.4006C12.6703 15.4663 12.8398 15.5002 13.011 15.5002C13.1822 15.5002 13.3517 15.4663 13.5098 15.4006C13.6679 15.3348 13.8114 15.2383 13.932 15.1169C14.442 14.6049 14.442 13.7769 13.932 13.2639L10.672 9.98586Z" fill="#86909C"></path></g></g></svg> <div data-v-41eefe39="" class="right"><span data-v-41eefe39="" class="descrip">
              开发工具
            </span></div></div></div><div data-v-41eefe39="" class="technology-box"><div data-v-41eefe39="" class="wrap"><svg data-v-41eefe39="" width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg" class="left"><g data-v-41eefe39="" id="&amp;#230;&amp;#161;&amp;#136;&amp;#228;&amp;#190;&amp;#139;"><path data-v-41eefe39="" id="Subtract" fill-rule="evenodd" clip-rule="evenodd" d="M1 2.5C1 1.94772 1.44772 1.5 2 1.5H14C14.5523 1.5 15 1.94772 15 2.5V14.5C15 15.0523 14.5523 15.5 14 15.5H2C1.44772 15.5 1 15.0523 1 14.5V2.5ZM3 5C3 4.72386 3.22386 4.5 3.5 4.5H12.5C12.7761 4.5 13 4.72386 13 5V5.3C13 5.57614 12.7761 5.8 12.5 5.8H3.5C3.22386 5.8 3 5.57614 3 5.3V5ZM3.5 7.5C3.22386 7.5 3 7.72386 3 8V8.3C3 8.57614 3.22386 8.8 3.5 8.8H4.5C4.77614 8.8 5 8.57614 5 8.3V8C5 7.72386 4.77614 7.5 4.5 7.5H3.5ZM7 8C7 7.72386 7.22386 7.5 7.5 7.5H8.5C8.77614 7.5 9 7.72386 9 8V8.3C9 8.57614 8.77614 8.8 8.5 8.8H7.5C7.22386 8.8 7 8.57614 7 8.3V8ZM11.5 7.5C11.2239 7.5 11 7.72386 11 8V8.3C11 8.57614 11.2239 8.8 11.5 8.8H12.5C12.7761 8.8 13 8.57614 13 8.3V8C13 7.72386 12.7761 7.5 12.5 7.5H11.5ZM3 11C3 10.7239 3.22386 10.5 3.5 10.5H7.5C7.77614 10.5 8 10.7239 8 11V11.3C8 11.5761 7.77614 11.8 7.5 11.8H3.5C3.22386 11.8 3 11.5761 3 11.3V11ZM10.5 10.5C10.2239 10.5 10 10.7239 10 11V11.3C10 11.5761 10.2239 11.8 10.5 11.8H12.5C12.7761 11.8 13 11.5761 13 11.3V11C13 10.7239 12.7761 10.5 12.5 10.5H10.5Z" fill="#86909C"></path></g></svg> <div data-v-41eefe39="" class="right"><span data-v-41eefe39="" class="descrip">
              代码人生
            </span></div></div></div><div data-v-41eefe39="" class="technology-box"><div data-v-41eefe39="" class="wrap"><svg data-v-41eefe39="" width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg" class="left"><g data-v-41eefe39="" id="&amp;#230;&amp;#161;&amp;#136;&amp;#228;&amp;#190;&amp;#139;"><path data-v-41eefe39="" id="Subtract" fill-rule="evenodd" clip-rule="evenodd" d="M14.9187 7.03385C15.0999 7.26744 14.9466 7.7 14.651 7.7H6.32905V4.5H5.02905V7.7H3.6C2.16406 7.7 1 6.53594 1 5.1C1 3.66406 2.16406 2.5 3.6 2.5H14.651C14.9466 2.5 15.0999 2.93257 14.9188 3.16616C14.5064 3.69779 14.2602 4.36959 14.2602 5.10001C14.2602 5.83043 14.5064 6.50222 14.9187 7.03385Z" fill="#86909C"></path><path data-v-41eefe39="" id="Subtract_2" fill-rule="evenodd" clip-rule="evenodd" d="M1.34902 14.5008C1.0534 14.5008 0.900077 14.0682 1.08126 13.8346C1.49363 13.303 1.7398 12.6312 1.7398 11.9008C1.7398 11.1704 1.49362 10.4986 1.08125 9.96694C0.900064 9.73335 1.05339 9.30078 1.34901 9.30078H12.4C13.8359 9.30078 15 10.4648 15 11.9008C15 13.3367 13.8359 14.5008 12.4 14.5008H1.34902Z" fill="#86909C"></path></g></svg> <div data-v-41eefe39="" class="right"><span data-v-41eefe39="" class="descrip">
              阅读
            </span></div></div></div></div> <!----></div><div class="byte-modal__footer"><div data-v-41eefe39="" class="left">跳过</div> <div data-v-41eefe39="" class="mid" style="display: none;">上一步</div> <div data-v-41eefe39="" class="right">
      至少选择1个分类
    </div></div></div></div></div><div data-transfer="true" class="risk-modal byte-modal v-transfer-dom" align-center=""><div class="byte-modal__mask" style="z-index: 1002; display: none;"></div><div class="byte-modal__wrapper" style="z-index: 1002; display: none;"><div class="byte-modal__content" style="width: 350px;"><!----><div class="byte-modal__body"><div class="risk-modal-inner"><div class="risk-modal-title">温馨提示</div> <div class="">当前操作失败，如有疑问，可点击申诉</div> <div class="risk-modal-footer"><button type="button" class="cancel-button risk-button byte-btn byte-btn--default byte-btn--large"><!----><!----><span class=""><span class="">前往申诉</span></span></button> <button type="button" class="risk-button byte-btn byte-btn--primary byte-btn--large"><!----><!----><span class=""><span class="">我知道了</span></span></button></div></div></div><!----></div></div></div><div data-v-813246ce="" data-transfer="true" class="upgrade-new-modal byte-modal v-transfer-dom"><div class="byte-modal__mask" style="z-index: 1003; display: none;"></div><div class="byte-modal__wrapper" style="z-index: 1003; display: none;"><div class="byte-modal__content" style="width: 311px;"><div class="byte-modal__header"><span class="byte-modal__title"></span><!----></div><div class="byte-modal__body"> <!----> <div data-v-813246ce="" class="close-icon"><img data-v-813246ce="" src="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/8867e249c23a7c0ea596c139befc04d7.svg" alt="" class=""></div></div><!----></div></div></div><div class="byte-tooltip byte-tooltip--dark" style="display: none; position: absolute; max-width: 480px; will-change: transform; z-index: 1008; top: 0px; left: 0px; transform: translate3d(879px, 719px, 0px);" x-placement="top">
        #工作中做得最正确的一件事#
      <div x-arrow="" class="popper__arrow" style="left: 0px;"></div></div><div class="byte-tooltip byte-tooltip--dark" style="display: none; position: absolute; max-width: 480px; will-change: transform; z-index: 1009; top: 0px; left: 0px; transform: translate3d(859px, 764px, 0px);" x-placement="top">
        #金石计划征文活动#
      <div x-arrow="" class="popper__arrow" style="left: 0px;"></div></div><div class="byte-tooltip byte-tooltip--dark" style="display: none; position: absolute; max-width: 480px; will-change: transform; z-index: 1010; top: 0px; left: 0px; transform: translate3d(873px, 832px, 0px);" x-placement="top">
        #我的技术写作成长之路#
      <div x-arrow="" class="popper__arrow" style="left: 0px;"></div></div><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/40.ddd7c99.css" rel="stylesheet" type="text/css" class=""><link href="//lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/43.f51e632.css" rel="stylesheet" type="text/css" class=""><div class="byte-tooltip byte-tooltip--dark" style="max-width: 480px; z-index: 1018; display: none; position: absolute; will-change: transform; top: 0px; left: 0px; transform: translate3d(871px, 515px, 0px);" x-placement="top">
        #挑战每日一条沸点#
      <div x-arrow="" class="popper__arrow" style="left: 0px;"></div></div></body><div id="immersive-translate-browser-popup" style="all: initial" class=""></div><script class="">console.log('%c想要加入稀土掘金？投递简历：https://job.toutiao.com/s/idq6X5rb','color:#1e80ff;');</script><style id="--extension-popup-styles" class="">@import url('https://fonts.googleapis.com/css?family=Inter:400,600&display=swap');</style></html>`
      
      const testHtml = `<div style="width: 1000px; padding: 30px; background: #f5f5f5; font-family: Arial, sans-serif;">
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
    </div>
`;
