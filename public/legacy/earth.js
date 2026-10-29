
/* =========================================
   AIRGUARD - REALISTIC 3D EARTH
   Requires Three.js r128 loaded before this file
========================================= */

(function () {
  "use strict";

  function initEarth() {
    const container = document.getElementById("globe");

    if (!container || !window.THREE) {
      console.error("AirGuard Earth: #globe or Three.js is missing.");
      return;
    }

    const THREE = window.THREE;
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      38,
      1,
      0.1,
      100
    );

    camera.position.z = 4.6;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true
    });

    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, 2)
    );

    renderer.setClearColor(0x000000, 0);
    container.replaceChildren(renderer.domElement);

    // -----------------------------------------
    // Lighting
    // -----------------------------------------

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));

    const sunlight = new THREE.DirectionalLight(0xffffff, 2.1);
    sunlight.position.set(4, 3, 5);
    scene.add(sunlight);

    const blueLight = new THREE.PointLight(0x389bff, 2.0);
    blueLight.position.set(-4, 1, -3);
    scene.add(blueLight);

    // -----------------------------------------
    // Load Earth textures
    // -----------------------------------------

    const loader = new THREE.TextureLoader();

    const earthTexture = loader.load(
      "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg",
      function () {
        console.log("AirGuard: Earth texture loaded.");
      },
      undefined,
      function (error) {
        console.error("Could not load Earth texture.", error);
      }
    );

    const normalTexture = loader.load(
      "https://threejs.org/examples/textures/planets/earth_normal_2048.jpg"
    );

    const cloudTexture = loader.load(
      "https://threejs.org/examples/textures/planets/earth_clouds_1024.png"
    );

    // -----------------------------------------
    // Main Earth
    // -----------------------------------------

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1.42, 96, 96),
      new THREE.MeshPhongMaterial({
        map: earthTexture,
        normalMap: normalTexture,
        normalScale: new THREE.Vector2(0.3, 0.3),
        shininess: 10
      })
    );

    earth.rotation.z = -0.12;
    scene.add(earth);

    // -----------------------------------------
    // Moving cloud layer
    // -----------------------------------------

    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.445, 96, 96),
      new THREE.MeshPhongMaterial({
        map: cloudTexture,
        transparent: true,
        opacity: 0.38,
        depthWrite: false
      })
    );

    clouds.rotation.z = earth.rotation.z;
    scene.add(clouds);

    // -----------------------------------------
    // Blue atmospheric glow
    // -----------------------------------------

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.49, 96, 96),
      new THREE.ShaderMaterial({
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vViewPosition;

          void main() {
            vec4 viewPosition =
              modelViewMatrix * vec4(position, 1.0);

            vNormal = normalize(normalMatrix * normal);
            vViewPosition = normalize(-viewPosition.xyz);

            gl_Position = projectionMatrix * viewPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          varying vec3 vViewPosition;

          void main() {
            float edge = 1.0 - max(
              dot(normalize(vNormal), normalize(vViewPosition)),
              0.0
            );

            float glow = pow(edge, 3.0);

            gl_FragColor = vec4(
              0.20,
              0.62,
              1.0,
              glow * 0.65
            );
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false
      })
    );

    scene.add(atmosphere);

    // -----------------------------------------
    // Star field
    // -----------------------------------------

    const starPositions = [];

    for (let i = 0; i < 1000; i++) {
      starPositions.push(
        (Math.random() - 0.5) * 24,
        (Math.random() - 0.5) * 24,
        -4 - Math.random() * 12
      );
    }

    const starGeometry = new THREE.BufferGeometry();

    starGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(starPositions, 3)
    );

    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0x9edaff,
        size: 0.025,
        transparent: true,
        opacity: 0.7
      })
    );

    scene.add(stars);

    // -----------------------------------------
    // Responsive sizing
    // -----------------------------------------

    function resizeEarth() {
      const width = container.clientWidth;
      const height = container.clientHeight;

      if (!width || !height) return;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height);
    }

    resizeEarth();

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(resizeEarth);
      observer.observe(container);
    } else {
      window.addEventListener("resize", resizeEarth);
    }

    // -----------------------------------------
    // Animation
    // -----------------------------------------

    let animationId;

    function animate() {
      animationId = requestAnimationFrame(animate);

      earth.rotation.y += 0.0008;
clouds.rotation.y += 0.0011;
stars.rotation.y += 0.00002;

      renderer.render(scene, camera);
    }

    function handleVisibility() {
      cancelAnimationFrame(animationId);

      if (!document.hidden) {
        animate();
      }
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibility
    );

    animate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initEarth);
  } else {
    initEarth();
  }
})();
